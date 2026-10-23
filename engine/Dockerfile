# The interview engine. The build context is the repo root, as Openship builds a Dockerfile that lives
# in a subfolder (-f engine/Dockerfile); engine/Dockerfile.dockerignore keeps that context to the engine.
#   docker build -f engine/Dockerfile -t case-owl-engine .        (from the repo root)
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

WORKDIR /srv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/srv/.venv/bin:$PATH"

COPY engine/pyproject.toml engine/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
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
