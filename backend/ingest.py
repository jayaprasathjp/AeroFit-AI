"""
Ingestion script for the AeroFit Resolver RAG pipeline.

Loads the Boeing 747-8F maintenance manual PDF, splits it into overlapping
chunks (preserving the source page number in metadata), embeds the chunks with
a local HuggingFace BGE model, and persists everything to a local ChromaDB
collection.

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
PDF_PATH = os.path.join(BASE_DIR, "data", "mock_747_amm.pdf")
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")
COLLECTION_NAME = "aerofit_amm"

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
    if not os.path.exists(PDF_PATH):
        raise FileNotFoundError(
            f"Could not find the manual at {PDF_PATH}. "
            "Place mock_747_amm.pdf inside backend/data/ before running."
        )

    print(f"Loading PDF: {PDF_PATH}")
    loader = PyPDFLoader(PDF_PATH)
    # Each page becomes a Document. PyPDFLoader stores the 0-indexed page
    # number under metadata['page'].
    pages = loader.load()
    print(f"Loaded {len(pages)} pages.")

    print("Splitting documents into chunks...")
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    # split_documents preserves each source page's metadata (including 'page')
    # on the resulting chunks.
    chunks = splitter.split_documents(pages)
    print(f"Created {len(chunks)} chunks.")

    print("Loading embedding model (first run downloads weights)...")
    embeddings = get_embeddings()

    print(f"Writing embeddings to ChromaDB at {CHROMA_DIR} ...")
    vectorstore = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        collection_name=COLLECTION_NAME,
        persist_directory=CHROMA_DIR,
    )
    vectorstore.persist()
    print("Ingestion complete. Vector store persisted.")


if __name__ == "__main__":
    ingest()
