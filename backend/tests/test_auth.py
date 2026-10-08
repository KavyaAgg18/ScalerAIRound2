from datetime import timedelta

from app.db import SessionLocal, utcnow
from app.models import Session


def test_login_me_logout(anon):
    assert anon.get("/api/auth/me").status_code == 401
    assert anon.post("/api/auth/login", json={"username": "demo", "password": "nope"}).status_code == 401
    r = anon.post("/api/auth/login", json={"username": "demo", "password": "demo1234"})
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()
    assert anon.get("/api/auth/me").json()["username"] == "demo"
    assert anon.post("/api/auth/logout").status_code == 204
    assert anon.get("/api/auth/me").status_code == 401


def test_data_endpoints_require_session(anon):
    assert anon.get("/api/hosted-zones").status_code == 401
    assert anon.post("/api/hosted-zones", json={"name": "x.com"}).status_code == 401


def test_expired_session(client):
    with SessionLocal() as db:
        for s in db.query(Session):
            s.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    r = client.get("/api/auth/me")
    assert r.status_code == 401
    assert "expired" in r.json()["detail"]
