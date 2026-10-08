from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.db import DATABASE_URL, SessionLocal, utcnow
from app.main import app
from app.models import RecordSet, Session


def url(zone, rid=""):
    return f"/api/hosted-zones/{zone['id']}/records" + (f"/{rid}" if rid != "" else "")


def test_session_cookie_works_from_a_new_browser_session(client):
    # simulates a page refresh: new client, same cookie
    cookie = client.cookies.get("r53_session")
    with TestClient(app) as fresh:
        fresh.cookies.set("r53_session", cookie)
        assert fresh.get("/api/auth/me").json()["username"] == "demo"
        assert fresh.get("/api/hosted-zones").status_code == 200


def test_logout_invalidates_the_token_server_side(client):
    cookie = client.cookies.get("r53_session")
    client.post("/api/auth/logout")
    with TestClient(app) as attacker:
        attacker.cookies.set("r53_session", cookie)
        assert attacker.get("/api/auth/me").status_code == 401


def test_session_is_stored_hashed_and_expired_rows_are_purged(client):
    cookie = client.cookies.get("r53_session")
    with SessionLocal() as db:
        ids = [s.id for s in db.query(Session)]
        assert cookie not in ids and len(ids[0]) == 64
        db.query(Session).update({Session.expires_at: utcnow() - timedelta(hours=1)})
        db.commit()
    client.post("/api/auth/login", json={"username": "demo", "password": "demo1234"})
    with SessionLocal() as db:
        assert db.query(Session).count() == 1  # the expired row was removed


def test_garbage_cookie_and_unauthenticated_record_endpoints(anon):
    anon.cookies.set("r53_session", "not-a-real-token")
    assert anon.get("/api/auth/me").status_code == 401
    for method, path in [
        ("get", "/api/hosted-zones/Z1/records"),
        ("post", "/api/hosted-zones/Z1/records"),
        ("patch", "/api/hosted-zones/Z1/records/1"),
        ("delete", "/api/hosted-zones/Z1/records/1"),
        ("patch", "/api/hosted-zones/Z1"),
        ("delete", "/api/hosted-zones/Z1"),
    ]:
        assert getattr(anon, method)(path).status_code == 401, (method, path)


def test_unknown_user_is_rejected(anon):
    r = anon.post("/api/auth/login", json={"username": "nobody", "password": "demo1234"})
    assert r.status_code == 401 and r.json()["detail"] == "Incorrect user name or password."


def test_data_is_in_the_sqlite_file(client, zone):
    client.post(url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]})
    # A brand-new engine (like a restarted process) reads the same rows from disk.
    other = create_engine(DATABASE_URL)
    with other.connect() as conn:
        assert conn.execute(text("select name from hosted_zones")).scalars().all() == ["example.com."]
        rows = conn.execute(text("select name, type, values_json from record_sets order by name, type")).all()
    other.dispose()
    assert ("www.example.com.", "A", '["192.0.2.1"]') in rows
    assert {(n, t) for n, t, _ in rows} >= {("example.com.", "NS"), ("example.com.", "SOA")}


def test_foreign_keys_are_enforced(client, zone):
    with SessionLocal() as db:
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_error_body_shape(client, zone):
    r = client.get("/api/hosted-zones/ZMISSING")
    assert r.status_code == 404 and r.json() == {
        "detail": "No hosted zone found with ID: ZMISSING",
        "errors": [],
    }
    r = client.post(url(zone), json={"name": "x", "type": "A", "values": ["nope"]})
    assert r.status_code == 422
    assert r.json()["errors"] == [{"field": "values", "message": r.json()["detail"]}]
    r = client.post("/api/hosted-zones", json={"description": "missing name"})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "name"
    r = client.post(url(zone), json={"name": "x", "type": "BOGUS", "values": ["1.1.1.1"]})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "type"


def test_invalid_list_params(client, zone):
    for params in ({"page": 0}, {"page_size": 0}, {"page_size": 101}, {"order": "sideways"}):
        assert client.get("/api/hosted-zones", params=params).status_code == 422, params
    assert client.get(url(zone), params={"sort": "values"}).status_code == 422


def test_description_limit(client, zone):
    assert (
        client.post("/api/hosted-zones", json={"name": "d.com", "description": "x" * 257}).status_code == 422
    )
    assert client.patch(f"/api/hosted-zones/{zone['id']}", json={"description": "x" * 257}).status_code == 422
    assert client.patch(f"/api/hosted-zones/{zone['id']}", json={"description": "x" * 256}).status_code == 200


def test_record_from_another_zone_is_not_found(client, zone):
    other = client.post("/api/hosted-zones", json={"name": "other.com"}).json()
    rid = client.post(url(other), json={"name": "a", "type": "A", "values": ["1.1.1.1"]}).json()["id"]
    assert client.get(url(zone, rid)).status_code == 404
    assert client.patch(url(zone, rid), json={"ttl": 5}).status_code == 404
    assert client.delete(url(zone, rid)).status_code == 404
    assert client.get(url(other, rid)).status_code == 200


def test_record_name_forms(client, zone):
    assert (
        client.post(url(zone), json={"name": "@", "type": "TXT", "values": ['"apex"']}).json()["name"]
        == "example.com."
    )
    assert (
        client.post(url(zone), json={"name": "API.Example.com.", "type": "A", "values": ["1.1.1.1"]}).json()[
            "name"
        ]
        == "api.example.com."
    )
    assert (
        client.post(url(zone), json={"name": "_dmarc", "type": "TXT", "values": ['"v=DMARC1"']}).status_code
        == 201
    )
    assert (
        client.post(url(zone), json={"name": "*.dev", "type": "A", "values": ["1.1.1.1"]}).status_code == 201
    )
    assert client.post(url(zone), json={"name": "a.*", "type": "A", "values": ["1.1.1.1"]}).status_code == 422
    r = client.post(url(zone), json={"name": "x" * 64, "type": "A", "values": ["1.1.1.1"]})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "name"


def test_values_are_trimmed_and_deduplicated(client, zone):
    r = client.post(
        url(zone), json={"name": "m", "type": "A", "values": [" 1.1.1.1 ", "1.1.1.1", "", "2.2.2.2"]}
    )
    assert r.json()["values"] == ["1.1.1.1", "2.2.2.2"]


def test_more_value_rules(client, zone):
    def bad(rtype, values):
        return (
            client.post(
                url(zone), json={"name": f"v-{rtype.lower()}", "type": rtype, "values": values}
            ).status_code
            == 422
        )

    assert bad("TXT", ['"' + "x" * 256 + '"'])  # one string > 255 chars
    assert not bad("TXT", ['"' + "x" * 255 + '" "' + "y" * 255 + '"'])  # long text split into strings
    assert bad("MX", ["70000 mail.example.com"])
    assert bad("SRV", ["1 10 70000 host.example.com"])
    assert bad("CAA", ['256 issue "x"'])
    assert bad("A", ["01.2.3.4"])
    assert bad("AAAA", ["2001:db8::g"])


def test_ttl_bounds(client, zone):
    assert (
        client.post(url(zone), json={"name": "t0", "type": "A", "ttl": 0, "values": ["1.1.1.1"]}).status_code
        == 201
    )
    assert (
        client.post(
            url(zone), json={"name": "t1", "type": "A", "ttl": 2147483647, "values": ["1.1.1.1"]}
        ).status_code
        == 201
    )
    assert (
        client.post(
            url(zone), json={"name": "t2", "type": "A", "ttl": 2147483648, "values": ["1.1.1.1"]}
        ).status_code
        == 422
    )


def test_reverse_cname_conflict_and_ns_routing(client, zone):
    client.post(url(zone), json={"name": "mail", "type": "MX", "values": ["10 mx.example.com"]})
    r = client.post(url(zone), json={"name": "mail", "type": "CNAME", "values": ["x.com"]})
    assert r.status_code == 409 and "can't coexist" in r.json()["detail"]
    r = client.post(
        url(zone),
        json={
            "name": "sub",
            "type": "NS",
            "values": ["ns.x.com"],
            "routing_policy": "weighted",
            "set_identifier": "a",
            "weight": 1,
        },
    )
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "routing_policy"


def test_weight_updates(client, zone):
    simple = client.post(url(zone), json={"name": "s", "type": "A", "values": ["1.1.1.1"]}).json()
    assert client.patch(url(zone, simple["id"]), json={"weight": 5}).status_code == 422
    w = client.post(
        url(zone),
        json={
            "name": "w",
            "type": "A",
            "values": ["1.1.1.1"],
            "routing_policy": "weighted",
            "set_identifier": "a",
            "weight": 1,
        },
    ).json()
    assert client.patch(url(zone, w["id"]), json={"weight": 200}).json()["weight"] == 200
    assert client.patch(url(zone, w["id"]), json={"weight": 256}).status_code == 422


def test_soa_value_validation_on_edit(client, zone):
    soa = next(r for r in client.get(url(zone)).json()["items"] if r["type"] == "SOA")
    assert client.patch(url(zone, soa["id"]), json={"values": ["garbage"]}).status_code == 422
    new = "ns-1.awsdns-01.com. hostmaster.example.com. 2 7200 900 1209600 86400"
    assert client.patch(url(zone, soa["id"]), json={"values": [new]}).json()["values"] == [new]


def test_update_changes_updated_at_only(client, zone):
    rec = client.post(url(zone), json={"name": "u", "type": "A", "values": ["1.1.1.1"]}).json()
    with SessionLocal() as db:
        db.query(RecordSet).filter_by(id=rec["id"]).update(
            {RecordSet.updated_at: utcnow() - timedelta(days=1)}
        )
        db.commit()
    before = client.get(url(zone, rec["id"])).json()
    after = client.patch(url(zone, rec["id"]), json={"ttl": 60}).json()
    assert after["created_at"] == rec["created_at"]
    assert before["updated_at"] < rec["created_at"] <= after["updated_at"]


def test_large_record_list_pagination(client, zone):
    with SessionLocal() as db:  # bulk insert 1,000 record sets directly
        for i in range(1000):
            r = RecordSet(hosted_zone_id=zone["id"], name=f"h{i:04d}.example.com.", type="A", ttl=300)
            r.values = [f"10.{i // 256}.{i % 256}.1"]
            db.add(r)
        db.commit()
    first = client.get(url(zone), params={"page_size": 300}).json()
    assert first["total"] == 1002 and len(first["items"]) == 300
    last = client.get(url(zone), params={"page_size": 300, "page": 4}).json()
    assert len(last["items"]) == 102 and last["items"][-1]["name"] == "h0999.example.com."
    assert client.get(url(zone), params={"page": 99}).json()["items"] == []
    assert client.get(url(zone), params={"q": "H012"}).json()["total"] == 10  # name search, case-insensitive
    assert client.get(url(zone), params={"q": "10.3.231"}).json()["total"] == 1  # value search
    assert client.get(url(zone), params={"type": "soa"}).json()["total"] == 1


def test_record_sorting(client, zone):
    for name, ttl in [("b", 60), ("a", 3600), ("c", 300)]:
        client.post(url(zone), json={"name": name, "type": "A", "ttl": ttl, "values": ["1.1.1.1"]})
    names = lambda **p: [r["name"].split(".")[0] for r in client.get(url(zone), params=p).json()["items"]]  # noqa: E731
    assert names(sort="name")[:2] == ["example", "example"] and names(sort="name")[2:] == ["a", "b", "c"]
    assert names(sort="name", order="desc")[0] == "c"
    ttls = [r["ttl"] for r in client.get(url(zone), params={"sort": "ttl"}).json()["items"]]
    assert ttls == sorted(ttls)


def test_zone_sorting_and_search_fields(client):
    for name, desc, n in [("aa.com", "zeta", 0), ("bb.com", "alpha", 2), ("cc.com", "", 1)]:
        z = client.post("/api/hosted-zones", json={"name": name, "description": desc}).json()
        for i in range(n):
            client.post(
                f"/api/hosted-zones/{z['id']}/records",
                json={"name": f"r{i}", "type": "A", "values": ["1.1.1.1"]},
            )
    order = lambda **p: [z["name"] for z in client.get("/api/hosted-zones", params=p).json()["items"]]  # noqa: E731
    assert order(sort="record_count", order="desc") == ["bb.com.", "cc.com.", "aa.com."]
    assert order(sort="description")[-1] == "aa.com."
    assert order(q="ALPHA") == ["bb.com."]  # description search
    zid = client.get("/api/hosted-zones", params={"q": "cc.com"}).json()["items"][0]["id"]
    assert order(q=zid.lower()) == ["cc.com."]  # ID search


def test_empty_database_lists(client):
    r = client.get("/api/hosted-zones").json()
    assert r == {"items": [], "total": 0, "page": 1, "page_size": 10}


def test_health(anon):
    assert anon.get("/api/health").json() == {"status": "ok"}
