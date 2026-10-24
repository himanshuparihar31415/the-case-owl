"""Production refuses development secrets; NODE_URL left out means no settling in production."""
from __future__ import annotations

import pytest

from app.config import DEV_SECRET, Settings

PROD = {"environment": "prod", "openai_api_key": "sk-test", "engine_service_token": "service-token",
        "engine_ui_secret": "u" * 32, "mongo_uri": "mongodb://db", "allowed_origins": "https://app.test"}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("NODE_URL", "NODE_INTERNAL_TOKEN", "ENVIRONMENT", "OPENAI_API_KEY", "MONGO_URI", "ALLOWED_ORIGINS",
                 "ENGINE_SERVICE_TOKEN", "ENGINE_UI_SECRET"):
        monkeypatch.delenv(name, raising=False)


def test_node_url_defaults_to_the_stub_in_development_and_to_nothing_in_production():
    assert Settings(_env_file=None).node_url == "http://localhost:5051"
    prod = Settings(_env_file=None, **PROD)
    assert prod.node_url == ""
    prod.check()  # no Node yet: its token is not needed


def test_production_with_a_node_needs_its_token():
    with pytest.raises(RuntimeError, match="NODE_INTERNAL_TOKEN"):
        Settings(_env_file=None, node_url="https://node.test", **PROD).check()
    Settings(_env_file=None, node_url="https://node.test", node_internal_token="node-token", **PROD).check()


def test_production_refuses_development_secrets_and_a_short_ui_secret():
    with pytest.raises(RuntimeError, match="ENGINE_SERVICE_TOKEN"):
        Settings(_env_file=None, **{**PROD, "engine_service_token": DEV_SECRET}).check()
    with pytest.raises(RuntimeError, match="32 bytes"):
        Settings(_env_file=None, **{**PROD, "engine_ui_secret": "short"}).check()
