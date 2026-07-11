"""
AeroFit Resolver — FastAPI backend.

Exposes a /api/search endpoint that performs Retrieval-Augmented Generation
over the Boeing 747-8F maintenance manual:

    1. Embed the user query and retrieve the top-3 chunks from ChromaDB.
    2. Build a grounded prompt from those chunks.
    3. Ask Google Vertex AI (Gemini) to answer using ONLY that context.
    4. Return the answer plus the most relevant page number.

Run:
    uvicorn main:app --reload --port 8000
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_community.vectorstores import Chroma

load_dotenv()

# --- Configuration ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")
COLLECTION_NAME = "aerofit_amm"
EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"
TOP_K = 3

# Gemini API configuration (read from environment / .env).
# Get a free key at https://aistudio.google.com/apikey
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

# Comma-separated list of allowed origins, or "*" for any (default).
# In production set e.g. ALLOWED_ORIGINS=https://your-frontend.a.run.app
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

PROMPT_TEMPLATE = (
    "You are an aviation mechanic assistant. Answer the user query using ONLY "
    "the following context chunks. If the answer is not in the context, say "
    "'I cannot find this in the manual.'\n\n"
    "Context:\n{chunks}\n\n"
    "User query: {query}\n\n"
    "Answer:"
)

# --- App setup -------------------------------------------------------------
app = FastAPI(title="AeroFit Resolver API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # No cookies/auth are used, so credentials stay off. This lets us safely
    # use "*" origins and avoids the wildcard-with-credentials CORS error.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Request / response models ---------------------------------------------
class SearchRequest(BaseModel):
    query: str


class SearchResponse(BaseModel):
    answer: str
    page: int
    snippet: str = ""


# --- Lazy singletons -------------------------------------------------------
_vectorstore: Chroma | None = None
_llm = None


def get_vectorstore() -> Chroma:
    """Load (once) the persisted ChromaDB collection for querying."""
    global _vectorstore
    if _vectorstore is None:
        if not os.path.isdir(CHROMA_DIR):
            raise HTTPException(
                status_code=500,
                detail="Vector store not found. Run `python ingest.py` first.",
            )
        embeddings = HuggingFaceBgeEmbeddings(
            model_name=EMBEDDING_MODEL_NAME,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )
        _vectorstore = Chroma(
            collection_name=COLLECTION_NAME,
            embedding_function=embeddings,
            persist_directory=CHROMA_DIR,
        )
    return _vectorstore


def get_llm():
    """Lazily initialize the Gemini model via the Google AI (API key) endpoint."""
    global _llm
    if _llm is None:
        if not GOOGLE_API_KEY:
            raise RuntimeError(
                "GOOGLE_API_KEY is not set. Get a free key at "
                "https://aistudio.google.com/apikey and add it to backend/.env"
            )
        from langchain_google_genai import ChatGoogleGenerativeAI

        _llm = ChatGoogleGenerativeAI(
            model=GEMINI_MODEL,
            google_api_key=GOOGLE_API_KEY,
            temperature=0.2,
            max_output_tokens=1024,
        )
    return _llm


# --- Routes ----------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query must not be empty.")

    # 1. Retrieve the top-K most relevant chunks.
    vectorstore = get_vectorstore()
    results = vectorstore.similarity_search(query, k=TOP_K)

    if not results:
        return SearchResponse(answer="I cannot find this in the manual.", page=1)

    # 2. Assemble the context and determine the best page to display.
    #    PyPDFLoader stores 0-indexed pages; react-pdf is 1-indexed, so +1.
    context_parts = []
    for doc in results:
        page_meta = doc.metadata.get("page", 0)
        context_parts.append(f"[Page {page_meta + 1}]\n{doc.page_content}")
    chunks_text = "\n\n---\n\n".join(context_parts)

    top_page = int(results[0].metadata.get("page", 0)) + 1
    # The full text of the best-matching chunk. The frontend highlights its
    # distinctive terms (part numbers, nomenclature) on the rendered page.
    top_snippet = results[0].page_content

    # 3. Build the grounded prompt.
    prompt = PROMPT_TEMPLATE.format(chunks=chunks_text, query=query)

    # 4. Call Gemini. Degrade gracefully if Vertex AI is not configured so the
    #    UI (and page navigation) still works during local development.
    try:
        llm = get_llm()
        response = llm.invoke(prompt)
        content = getattr(response, "content", str(response))
        if isinstance(content, list):
            answer = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content]).strip()
        else:
            answer = str(content).strip()
    except Exception as exc:  # noqa: BLE001 - surface config issues to the client
        answer = (
            "[Gemini unavailable] Returning retrieved context only. "
            f"Reason: {exc}\n\n{chunks_text}"
        )

    return SearchResponse(answer=answer, page=top_page, snippet=top_snippet)
