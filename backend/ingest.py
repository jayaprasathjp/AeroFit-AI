"""
Ingestion script for the AeroFit Resolver RAG pipeline.

Loads the Boeing 747-8F AMM and IPC PDFs, splits them into overlapping chunks
(preserving the source page number AND document type in metadata), embeds the
chunks with a local HuggingFace BGE model, and persists everything to a local
ChromaDB collection.

Run once before starting the API:
    python ingest.py
"""

import os

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_community.vectorstores import Chroma

# --- Configuration ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")
COLLECTION_NAME = "aerofit_amm"

# Source documents to ingest. Each is tagged so retrieval can tell the user
# (and the PDF viewer) which manual a passage came from. ``file`` matches the
# copy served from the frontend's /public folder.
SOURCES = [
    {
        "path": "amm.pdf",
        "doc_type": "AMM",
        "document_id": "B748-AMM-001",
        "file": "amm.pdf",
    },
    {
        "path": "ipc.pdf",
        "doc_type": "IPC",
        "document_id": "B748-IPC-002",
        "file": "ipc.pdf",
    },
]

# A small, CPU-friendly embedding model that avoids any GCP auth requirements
# during local development/testing.
EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


def get_embeddings() -> HuggingFaceBgeEmbeddings:
    """Create the local embedding model used for both ingest and query."""
    return HuggingFaceBgeEmbeddings(
        model_name=EMBEDDING_MODEL_NAME,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def ingest() -> None:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    all_chunks = []
    for src in SOURCES:
        pdf_path = os.path.join(DATA_DIR, src["path"])
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(
                f"Could not find '{src['path']}' in {DATA_DIR}. "
                "Place the AMM and IPC PDFs inside backend/data/ before running."
            )

        print(f"Loading {src['doc_type']}: {pdf_path}")
        # Each page becomes a Document. PyPDFLoader stores the 0-indexed page
        # number under metadata['page'].
        pages = PyPDFLoader(pdf_path).load()
        chunks = splitter.split_documents(pages)

        # Tag every chunk with its document identity so retrieval can surface it.
        for chunk in chunks:
            chunk.metadata["doc_type"] = src["doc_type"]
            chunk.metadata["document_id"] = src["document_id"]
            chunk.metadata["file"] = src["file"]

        print(f"  -> {len(pages)} pages, {len(chunks)} chunks.")
        all_chunks.extend(chunks)

    print(f"Total chunks across all documents: {len(all_chunks)}")

    print("Loading embedding model (first run downloads weights)...")
    embeddings = get_embeddings()

    print(f"Writing embeddings to ChromaDB at {CHROMA_DIR} ...")
    vectorstore = Chroma.from_documents(
        documents=all_chunks,
        embedding=embeddings,
        collection_name=COLLECTION_NAME,
        persist_directory=CHROMA_DIR,
    )
    vectorstore.persist()
    print("Ingestion complete. Vector store persisted.")


if __name__ == "__main__":
    ingest()
