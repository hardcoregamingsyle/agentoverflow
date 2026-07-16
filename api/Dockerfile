FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/opt/fastembed

WORKDIR /srv/ao

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model at build time so cold start is fast
# and the runtime container never needs to reach the network.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')" \
    && chmod -R a+rX /opt/fastembed

COPY app ./app

RUN useradd --system --no-create-home ao
USER ao

EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
