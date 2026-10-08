import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SEED_DEMO_DATA"] = "0"
os.environ["STATIC_DIR"] = os.path.join(_tmp, "no-static")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture
def anon():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(anon):
    assert anon.post("/api/auth/login", json={"username": "demo", "password": "demo1234"}).status_code == 200
    return anon


@pytest.fixture
def zone(client):
    r = client.post("/api/hosted-zones", json={"name": "Example.com.", "description": "test"})
    assert r.status_code == 201, r.text
    return r.json()
