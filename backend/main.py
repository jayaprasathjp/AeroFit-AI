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
DOCUMENT_ID = "B748-AMM-IPC-001"

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
    "You are an aviation maintenance assistant for the Boeing 747-8F fleet. "
    "Answer the user query using ONLY the following context chunks. If the answer "
    "is not in the context, set the answer to 'I cannot find this in the manual.'\n\n"
    "Respond with THREE sections in this exact order:\n\n"
    "<answer>\nYour concise response to the query. Markdown allowed.\n</answer>\n\n"
    "<snippet>\nAn exact, verbatim excerpt from the context that directly supports "
    "your answer.\n</snippet>\n\n"
    "<decision>\n"
    "If the query is about a part and its approved alternates, output a JSON object "
    "using this schema. Otherwise output {{}}.\n"
    "{{\n"
    '  "primary_part": "primary part number",\n'
    '  "nomenclature": "part name",\n'
    '  "revision": "manual revision if present, else empty string",\n'
    '  "alternates": [\n'
    "    {{\n"
    '      "part_number": "alternate part number",\n'
    '      "classification": "one of: True Alternate, Oversized Version, Optional Fit",\n'
    '      "notes": "short technical note",\n'
    '      "restrictions": "operational restriction if any, else empty string",\n'
    '      "hardware": "required brackets/kits/manual refs if any, else empty string",\n'
    '      "el_signoff": true or false\n'
    "    }}\n"
    "  ]\n"
    "}}\n"
    "Only use facts present in the context. Never invent part numbers.\n"
    "</decision>\n\n"
    "Context:\n{chunks}\n\n"
    "User query: {query}\n"
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


class AlternatePart(BaseModel):
    part_number: str = ""
    classification: str = ""  # True Alternate | Oversized Version | Optional Fit
    notes: str = ""
    restrictions: str = ""
    hardware: str = ""
    el_signoff: bool = False


class Decision(BaseModel):
    primary_part: str = ""
    nomenclature: str = ""
    revision: str = ""
    document: str = ""
    alternates: list[AlternatePart] = []


class SearchResponse(BaseModel):
    answer: str
    page: int
    snippet: str = ""
    decision: Decision | None = None


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
    decision: Decision | None = None

    # 3. Build the grounded prompt.
    prompt = PROMPT_TEMPLATE.format(chunks=chunks_text, query=query)

    # 4. Call Gemini. Degrade gracefully if Vertex AI is not configured so the
    #    UI (and page navigation) still works during local development.
    try:
        import json
        import re

        llm = get_llm()
        response = llm.invoke(prompt)
        content = getattr(response, "content", str(response))
        if isinstance(content, list):
            content_str = "".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content]).strip()
        else:
            content_str = str(content).strip()

        # Extract XML tags
        answer_match = re.search(r'<answer>(.*?)</answer>', content_str, re.DOTALL | re.IGNORECASE)
        snippet_match = re.search(r'<snippet>(.*?)</snippet>', content_str, re.DOTALL | re.IGNORECASE)

        if answer_match:
            answer = answer_match.group(1).strip()
        else:
            # Fallback if no tags found or if output was severely truncated
            # We try to grab anything that looks like it was after <answer>
            partial_match = re.search(r'<answer>(.*)', content_str, re.DOTALL | re.IGNORECASE)
            answer = partial_match.group(1).strip() if partial_match else content_str.strip()

        if snippet_match:
            top_snippet = snippet_match.group(1).strip() or top_snippet

        # Parse the optional structured decision card.
        decision_match = re.search(
            r"<decision>(.*?)</decision>", content_str, re.DOTALL | re.IGNORECASE
        )
        if decision_match:
            raw_decision = decision_match.group(1).strip()
            # Strip any markdown code fences the model may add.
            raw_decision = re.sub(r"^```(?:json)?", "", raw_decision).strip()
            raw_decision = re.sub(r"```$", "", raw_decision).strip()
            try:
                data = json.loads(raw_decision)
                if isinstance(data, dict) and data.get("alternates"):
                    decision = Decision.model_validate(data)
                    # Fill compliance fields from context if the model omitted them.
                    if not decision.revision:
                        rev = re.search(
                            r"REVISION[:\s]+([\d.]+)", chunks_text, re.IGNORECASE
                        )
                        if rev:
                            decision.revision = rev.group(1)
                    if not decision.document:
                        decision.document = DOCUMENT_ID
            except (json.JSONDecodeError, ValueError):
                decision = None

    except Exception as exc:  # noqa: BLE001 - surface config issues to the client
        raw_output = locals().get("content_str", "not_set")
        answer = (
            "[Gemini unavailable or parsing failed] Returning retrieved context only. "
            f"Reason: {exc}\nRaw LLM Output:\n{raw_output}\n\n{chunks_text}"
        )

    return SearchResponse(
        answer=answer, page=top_page, snippet=top_snippet, decision=decision
    )
