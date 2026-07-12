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
    "Answer the user query using ONLY the context chunks below. Paraphrase in your "
    "own words \u2014 do NOT copy long passages verbatim.\n\n"
    "Return ONLY one valid JSON object (no markdown fences, no extra prose) with the "
    'keys "answer" and "decision".\n\n'
    '"answer": a concise answer to the query. If the answer is not in the context, set '
    'it exactly to "I cannot find this in the manual."\n\n'
    '"decision": use null UNLESS the context lists a primary part together with one or '
    "more approved alternates or classifications (this includes IPC parts tables with "
    "ITEM / PART NUMBER / NOMENCLATURE / CLASSIFICATION columns, where the first row is "
    "the primary part and rows marked True Alternate / Oversized / Optional Fit are the "
    "alternates). In that case set decision to an object with this schema:\n"
    "{{\n"
    '  "primary_part": "primary part number",\n'
    '  "nomenclature": "part name",\n'
    '  "revision": "manual revision if present, else empty string",\n'
    '  "alternates": [\n'
    "    {{\n"
    '      "part_number": "alternate part number",\n'
    '      "classification": "True Alternate | Oversized Version | Optional Fit",\n'
    '      "notes": "short technical note in your own words",\n'
    '      "restrictions": "operational restriction if any, else empty string",\n'
    '      "hardware": "required brackets/kits/manual refs if any, else empty string",\n'
    '      "el_signoff": true or false\n'
    "    }}\n"
    "  ]\n"
    "}}\n"
    "Only use facts present in the context. Never invent part numbers.\n\n"
    "{history}"
    "Context:\n{chunks}\n\n"
    "Current user query: {query}\n"
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
class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class SearchRequest(BaseModel):
    query: str
    doc_type: str | None = None  # "AMM" | "IPC" to scope the search, else all
    history: list[ChatMessage] = []  # prior turns for follow-up context


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
    found: bool = True  # False when the answer isn't in the manual
    snippet: str = ""
    sources: list[int] = []
    citations: list[Citation] = []
    decision: Decision | None = None


# --- LLM structured-output schema ------------------------------------------
# Kept minimal and separate from the API models so the schema handed to Gemini
# (via function-calling) stays small and unambiguous. Stock/compliance fields
# are filled server-side afterward, not by the model.
class LLMAlternate(BaseModel):
    part_number: str = ""
    classification: str = ""  # True Alternate | Oversized Version | Optional Fit
    notes: str = ""
    restrictions: str = ""
    hardware: str = ""
    el_signoff: bool = False


class LLMDecision(BaseModel):
    primary_part: str = ""
    nomenclature: str = ""
    revision: str = ""
    alternates: list[LLMAlternate] = []


class LLMOutput(BaseModel):
    """The single object Gemini must return."""

    answer: str = "I cannot find this in the manual."
    decision: LLMDecision | None = None


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

        base_kwargs = dict(
            model=GEMINI_MODEL,
            google_api_key=GOOGLE_API_KEY,
            temperature=0.2,
            max_output_tokens=2048,
            safety_settings=safety_settings,
        )
        _llm = ChatGoogleGenerativeAI(**base_kwargs)
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
    #    Optionally scope the search to a single document type (AMM or IPC).
    #    For follow-ups ("which one is in stock?"), blend the previous user turn
    #    into the retrieval query so short questions still match the right part.
    vectorstore = get_vectorstore()
    prev_user = next(
        (m.content for m in reversed(request.history) if m.role == "user"), ""
    )
    retrieval_query = f"{prev_user} {query}".strip() if prev_user else query
    doc_filter = (
        {"doc_type": request.doc_type}
        if request.doc_type in ("AMM", "IPC")
        else None
    )
    try:
        scored = vectorstore.similarity_search_with_relevance_scores(
            retrieval_query, k=TOP_K, filter=doc_filter
        )
    except Exception:  # noqa: BLE001 - fall back if the store lacks score support
        scored = [
            (doc, 0.0)
            for doc in vectorstore.similarity_search(
                retrieval_query, k=TOP_K, filter=doc_filter
            )
        ]

    if not scored:
        return SearchResponse(
            answer="I cannot find this in the manual.", page=1, found=False
        )

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
    answer = "I cannot find this in the manual."

    # 3. Build the grounded prompt, including recent conversation for follow-ups.
    history_text = ""
    if request.history:
        recent = request.history[-6:]  # cap context to the last few turns
        lines = [
            f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}"
            for m in recent
        ]
        history_text = "Conversation so far:\n" + "\n".join(lines) + "\n\n"
    prompt = PROMPT_TEMPLATE.format(
        chunks=chunks_text, query=query, history=history_text
    )

    # 4. Call Gemini. Degrade gracefully if it is not configured so the UI
    #    (and page navigation) still works during local development.
    try:
        import json
        import re

        llm = get_llm()
        answer_text = ""
        dec_dict = None

        # Primary path: native structured output (function-calling). Constrained
        # decoding => always valid, complete JSON; immune to the recitation stop
        # that truncates free-text generation.
        try:
            result = llm.with_structured_output(LLMOutput).invoke(prompt)
            if isinstance(result, LLMOutput):
                answer_text = result.answer
                dec_dict = (
                    result.decision.model_dump() if result.decision else None
                )
            elif isinstance(result, dict):
                answer_text = result.get("answer", "")
                dec_dict = result.get("decision")
        except Exception:  # noqa: BLE001 - fall back to plain text + JSON parse
            response = llm.invoke(prompt)
            content = getattr(response, "content", str(response))
            content_str = (
                content
                if isinstance(content, str)
                else "".join(
                    c.get("text", "") if isinstance(c, dict) else str(c)
                    for c in content
                )
            )
            clean = re.sub(r"^```(?:json)?", "", content_str.strip()).strip()
            clean = re.sub(r"```$", "", clean).strip()
            try:
                data = json.loads(clean)
            except (json.JSONDecodeError, ValueError):
                # Salvage the answer from a partial/truncated JSON response.
                m = re.search(r'"answer"\s*:\s*"(.*?)"\s*[,}]', clean, re.DOTALL)
                salvaged = (
                    m.group(1).replace("\\n", "\n").replace('\\"', '"')
                    if m
                    else clean
                )
                data = {"answer": salvaged}
            answer_text = data.get("answer", "")
            dec_dict = data.get("decision")

        if answer_text and answer_text.strip():
            answer = answer_text.strip()

        if isinstance(dec_dict, dict) and dec_dict.get("alternates"):
            decision = Decision.model_validate(dec_dict)
            # Fill compliance fields from context if the model omitted them.
            if not decision.revision:
                rev = re.search(
                    r"REVISION[:\s]+([\d.]+)", chunks_text, re.IGNORECASE
                )
                decision.revision = rev.group(1) if rev else MANUAL_REVISION
            if not decision.document:
                decision.document = top_meta.get("document_id", DOCUMENT_ID)
            # Compliance check: is the cited revision the active one?
            decision.revision_current = decision.revision == MANUAL_REVISION

    except Exception as exc:  # noqa: BLE001 - surface config issues to the client
        raw_output = locals().get("answer_text", "not_set")
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

    # If the answer isn't grounded in the manual, don't cite pages or jump the
    # viewer to an irrelevant source.
    found = "cannot find" not in answer.lower()
    if not found:
        sources = []
        citations = []
        top_file = ""
        top_doc_type = ""

    return SearchResponse(
        answer=answer,
        page=top_page,
        file=top_file,
        doc_type=top_doc_type,
        found=found,
        snippet=top_snippet,
        sources=sources,
        citations=citations,
        decision=decision,
    )
