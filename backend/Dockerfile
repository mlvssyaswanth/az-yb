FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Dev extras (pytest) are included so tests can run inside the same image.
COPY pyproject.toml ./
RUN mkdir app && pip install --no-cache-dir ".[dev]"

COPY . .
EXPOSE 8000
# Migrations and data loading run in the separate "ingest" compose service.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
