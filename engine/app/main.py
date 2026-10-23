"""The interview engine service (docs/engine-contract.md).

Run from engine/:  uv run uvicorn app.main:app --port 8780
Tests build their own app with fakes: create_app(settings, realtime=..., store=..., http=...).
"""
from __future__ import annotations

import logging
import re
import ssl
from contextlib import asynccontextmanager

import httpx
import truststore
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import api, ui
from .config import Settings, get_settings
from .errors import AppError
from .realtime import OpenAIRealtime, Realtime
from .registry import Registry
from .runtime.interview import Services
from .settle import SettleClient
from .store import MemoryStore, MongoStore, Store, case_files

log = logging.getLogger("engine")
TOKEN_RE = re.compile(r"(token=)[^&\s\"']+")


class RedactTokens(logging.Filter):
    """The page's UI token travels in the socket URL (as the contract says); keep it out of the logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = TOKEN_RE.sub(r"\1[redacted]", record.msg)
        if record.args:
            record.args = tuple(TOKEN_RE.sub(r"\1[redacted]", a) if isinstance(a, str) else a for a in record.args)
        return True


for _name in ("uvicorn.access", "uvicorn.error"):
    logging.getLogger(_name).addFilter(RedactTokens())


def create_app(settings: Settings | None = None, *, realtime: Realtime | None = None, store: Store | None = None,
               http: httpx.AsyncClient | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        settings.check()
        # Verify TLS against the OS trust store, as curl does: python.org builds and corporate TLS
        # inspection often break Python's bundled CA list (seen in the spike).
        ssl_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        client = http or httpx.AsyncClient(verify=ssl_ctx, timeout=20.0)
        st = store or (MongoStore(settings.mongo_uri, settings.mongo_db) if settings.mongo_uri else MemoryStore())
        if isinstance(st, MongoStore):
            await st.setup()
            for published in await st.sync_file_cases(case_files()):
                log.info("published case %s from cases/", published)
        registry = Registry(settings.max_calls)
        services = Services(settings=settings, realtime=realtime or OpenAIRealtime(client, settings.openai_api_key, ssl_ctx),
                            store=st, http=client,
                            settle=SettleClient(client, settings.node_url, settings.node_internal_token,
                                                settings.time_scale),
                            on_finished=registry.finished)
        app.state.settings, app.state.registry = settings, registry
        registry.services = services
        registry.start(services)
        log.info("engine %s up (version %s, %s store, model %s)", settings.instance_id, settings.engine_version,
                 type(st).__name__, settings.realtime_model)
        if not services.settle.enabled:
            log.warning("NODE_URL is not set: interviews are saved here but not settled with the platform")
        yield
        await registry.shutdown(settings.shutdown_wait_s)
        await registry.stop()
        if http is None:
            await client.aclose()
        await st.close()

    # No interactive API docs in production: the contract doc is the reference.
    docs = {} if settings.environment == "dev" else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="Case Owl interview engine", version="1", lifespan=lifespan, **docs)

    @app.exception_handler(AppError)
    async def app_error(_request: Request, err: AppError) -> JSONResponse:
        return JSONResponse({"error": {"code": err.code, "message": err.message}}, status_code=err.status)

    @app.exception_handler(RequestValidationError)
    async def invalid(_request: Request, err: RequestValidationError) -> JSONResponse:
        first = err.errors()[0] if err.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return JSONResponse({"error": {"code": "invalid_request", "message": f"{where}: {first.get('msg', 'invalid')}"}},
                            status_code=400)

    app.include_router(api.router)
    app.include_router(ui.router)
    return app


app = create_app()
