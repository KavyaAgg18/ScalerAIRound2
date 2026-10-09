# Stage 1: static Next.js export
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: FastAPI serves /api and the static export from one origin
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /bin/uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/app ./app
COPY --from=web /web/out /app/static

ENV STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:////data/route53.db \
    COOKIE_SECURE=1
VOLUME /data
EXPOSE 8000
# One worker: SQLite + a demo don't need more.
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
