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

from stock_service import get_stock_provider, now_iso

load_dotenv()

# --- Configuration ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")
COLLECTION_NAME = "aerofit_amm"
EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"
TOP_K = 3
DOCUMENT_ID = "B748-AMM-IPC-001"
MANUAL_REVISION = "14.2"  # active revision of the ingested manual

# Live inventory (AMAP) lookup behind a swappable interface. The mock provider
# hot-reloads data/mock_stock.json, so stock is dynamic at runtime and the whole
# thing can be replaced by a real AMAP API client without touching this route.
stock_provider = get_stock_provider()

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
    "Respond with TWO sections in this exact order:\n\n"
    "<answer>\nA concise response to the query, written in your own words "
    "(do not copy long passages verbatim). Markdown allowed.\n</answer>\n\n"
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
    '      "notes": "short technical note in your own words",\n'
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
    stock: int = 0


class Decision(BaseModel):
    primary_part: str = ""
    primary_stock: int = 0
    nomenclature: str = ""
    revision: str = ""
    revision_current: bool = True
    document: str = ""
    stock_checked_at: str = ""
    stock_source: str = ""
    alternates: list[AlternatePart] = []


class Citation(BaseModel):
    page: int
    score: float = 0.0  # relevance 0..1 (higher = better match)
    doc_type: str = ""  # AMM | IPC
    file: str = ""  # public PDF filename to open


class SearchResponse(BaseModel):
    answer: str
    page: int
    file: str = ""  # public PDF filename for the top result
    doc_type: str = ""  # AMM | IPC for the top result
    snippet: str = ""
    sources: list[int] = []
    citations: list[Citation] = []
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
        from langchain_google_genai import (
            ChatGoogleGenerativeAI,
            HarmBlockThreshold,
            HarmCategory,
        )

        # Disable safety blocking so aviation/maintenance wording (e.g. "failure",
        # "danger", fuel/explosive terms) doesn't cause premature truncation.
        safety_settings = {
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        _llm = ChatGoogleGenerativeAI(
            model=GEMINI_MODEL,
            google_api_key=GOOGLE_API_KEY,
            temperature=0.2,
            max_output_tokens=2048,
            safety_settings=safety_settings,
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

    # 1. Retrieve the top-K most relevant chunks, with relevance scores.
    vectorstore = get_vectorstore()
    try:
        scored = vectorstore.similarity_search_with_relevance_scores(query, k=TOP_K)
    except Exception:  # noqa: BLE001 - fall back if the store lacks score support
        scored = [(doc, 0.0) for doc in vectorstore.similarity_search(query, k=TOP_K)]

    if not scored:
        return SearchResponse(answer="I cannot find this in the manual.", page=1)

    results = [doc for doc, _ in scored]

    # 2. Assemble the context, page sources, and per-page confidence citations.
    #    PyPDFLoader stores 0-indexed pages; react-pdf is 1-indexed, so +1.
    #    Pages are de-duplicated per (document, page) since AMM p4 != IPC p4.
    context_parts = []
    sources: list[int] = []  # unique 1-indexed pages, in relevance order
    citations: list[Citation] = []
    seen: set = set()
    for doc, score in scored:
        meta = doc.metadata
        page_1indexed = int(meta.get("page", 0)) + 1
        doc_type = meta.get("doc_type", "")
        file = meta.get("file", "")
        label = f"[{doc_type or 'DOC'} · Page {page_1indexed}]"
        context_parts.append(f"{label}\n{doc.page_content}")
        key = (file, page_1indexed)
        if key not in seen:
            seen.add(key)
            if page_1indexed not in sources:
                sources.append(page_1indexed)
            citations.append(
                Citation(
                    page=page_1indexed,
                    score=round(max(0.0, min(1.0, score)), 3),
                    doc_type=doc_type,
                    file=file,
                )
            )
    chunks_text = "\n\n---\n\n".join(context_parts)

    top_meta = results[0].metadata
    top_page = int(top_meta.get("page", 0)) + 1
    top_file = top_meta.get("file", "")
    top_doc_type = top_meta.get("doc_type", "")
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

        # Extract the answer section.
        answer_match = re.search(r'<answer>(.*?)</answer>', content_str, re.DOTALL | re.IGNORECASE)

        if answer_match:
            answer = answer_match.group(1).strip()
        else:
            # Fallback if the closing tag is missing (e.g. truncated output):
            # grab everything after <answer>, or the whole response.
            partial_match = re.search(r'<answer>(.*)', content_str, re.DOTALL | re.IGNORECASE)
            answer = partial_match.group(1).strip() if partial_match else content_str.strip()

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
                        decision.revision = rev.group(1) if rev else MANUAL_REVISION
                    if not decision.document:
                        decision.document = top_meta.get("document_id", DOCUMENT_ID)
                    # Compliance check: is the cited revision the active one?
                    decision.revision_current = (
                        decision.revision == MANUAL_REVISION
                    )
            except (json.JSONDecodeError, ValueError):
                decision = None

    except Exception as exc:  # noqa: BLE001 - surface config issues to the client
        raw_output = locals().get("content_str", "not_set")
        answer = (
            "[Gemini unavailable or parsing failed] Returning retrieved context only. "
            f"Reason: {exc}\nRaw LLM Output:\n{raw_output}\n\n{chunks_text}"
        )

    # 5. Inject live AMAP stock levels into the decision (default 0 if unknown).
    if decision is not None:
        decision.primary_stock = stock_provider.get_stock(decision.primary_part)
        for alt in decision.alternates:
            alt.stock = stock_provider.get_stock(alt.part_number)
        decision.stock_checked_at = now_iso()
        decision.stock_source = stock_provider.source_name

    return SearchResponse(
        answer=answer,
        page=top_page,
        file=top_file,
        doc_type=top_doc_type,
        snippet=top_snippet,
        sources=sources,
        citations=citations,
        decision=decision,
    )
