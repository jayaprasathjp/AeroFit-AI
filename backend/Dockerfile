# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model into the image so cold starts on Cloud Run
# don't hit the network (avoids latency and SSL issues at runtime).
RUN python -c "from langchain_huggingface import HuggingFaceEmbeddings; HuggingFaceEmbeddings(model_name='BAAI/bge-small-en-v1.5', model_kwargs={'device':'cpu'}, encode_kwargs={'normalize_embeddings': True})"

# Copy the app source
COPY . .

# Generate the ChromaDB vector store during the build so it is baked into the image.
# This is necessary because chroma_db/ is excluded via .gitignore and won't be available in Cloud Build.
RUN python ingest.py

# Cloud Run injects $PORT (defaults to 8080). Bind to it on 0.0.0.0.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]