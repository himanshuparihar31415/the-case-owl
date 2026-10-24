# The interview engine. The build context is the repo root (deploy/deploy.sh builds it this way);
# engine/Dockerfile.dockerignore keeps that context to the engine.
#   docker build -f engine/Dockerfile -t case-owl-engine .        (from the repo root)
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

WORKDIR /srv
# UV_HTTP_TIMEOUT: a slow link timed a wheel download out at uv's default 30 s (24 Oct).
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_HTTP_TIMEOUT=180 PYTHONUNBUFFERED=1 PATH="/srv/.venv/bin:$PATH"

COPY engine/pyproject.toml engine/uv.lock ./
# The cache mount keeps downloaded wheels between builds, so a dependency change refetches only what changed.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY engine/app ./app
COPY engine/cases ./cases

ARG ENGINE_VERSION=unknown
ENV ENGINE_VERSION=$ENGINE_VERSION

# A stop hands live interviews to the next container (app/registry.py), well inside Docker's 10 s before
# SIGKILL: uvicorn closes the page sockets at once (1012, the page reconnects) and waits at most 3 s for
# in-flight requests, then the engine waits up to SHUTDOWN_WAIT_S (5 s) for interviews already ending.
# exec: uvicorn is PID 1 and gets the SIGTERM itself. Its WebSocket pings (every 20 s) keep the page's
# socket inside the proxy's 60 s read timeout.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 3"]
