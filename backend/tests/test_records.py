import pytest

from app.db import SessionLocal
from app.models import RecordSet

VALID = {
    "A": ["192.0.2.1", "192.0.2.2"],
    "AAAA": ["2001:db8::1"],
    "CNAME": ["target.example.net"],
    "TXT": ['"hello world"', '"part1" "part2"'],
    "MX": ["10 mail.example.com."],
    "NS": ["ns1.other.net"],
    "PTR": ["host.example.com"],
    "SRV": ["1 10 5269 xmpp.example.com"],
    "CAA": ['0 issue "amazon.com"'],
}
INVALID = {
    "A": ["999.1.1.1"],
    "AAAA": ["192.0.2.1"],
    "CNAME": ["a.com", "b.com"],
    "TXT": ["unquoted"],
    "MX": ["mail.example.com"],
    "NS": ["not a host"],
    "PTR": ["bad host!"],
    "SRV": ["1 10 mail.example.com"],
    "CAA": ['0 bogus "x"'],
}


def url(zone, rid=""):
    return f"/api/hosted-zones/{zone['id']}/records" + (f"/{rid}" if rid != "" else "")


@pytest.mark.parametrize("rtype", VALID)
def test_each_type_valid_and_invalid(client, zone, rtype):
    r = client.post(url(zone), json={"name": f"t-{rtype.lower()}", "type": rtype, "values": VALID[rtype]})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == f"t-{rtype.lower()}.example.com."
    assert r.json()["values"] == VALID[rtype]
    r = client.post(url(zone), json={"name": f"bad-{rtype.lower()}", "type": rtype, "values": INVALID[rtype]})
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "values"


def test_validation_rules(client, zone):
    def post(**kw):
        return client.post(url(zone), json={"name": "x", "type": "A", "values": ["1.1.1.1"], **kw})

    assert post(ttl=-1).status_code == 422
    assert post(values=["", "  "]).status_code == 422
    assert post(name="bad name").status_code == 422
    assert post(type="SOA").status_code == 422
    assert client.post(url(zone), json={"name": "", "type": "CNAME", "values": ["a.com"]}).status_code == 422
    assert client.post(url(zone), json={"name": "*", "type": "NS", "values": ["a.com"]}).status_code == 422
    assert post(name="*").status_code == 201


def test_uniqueness_and_cname_conflicts(client, zone):
    a = {"name": "www", "type": "A", "values": ["1.1.1.1"]}
    assert client.post(url(zone), json=a).status_code == 201
    assert client.post(url(zone), json=a).status_code == 409
    assert (
        client.post(url(zone), json={"name": "www", "type": "CNAME", "values": ["x.com"]}).status_code == 409
    )
    client.post(url(zone), json={"name": "c", "type": "CNAME", "values": ["x.com"]})
    assert client.post(url(zone), json={"name": "c", "type": "TXT", "values": ['"x"']}).status_code == 409


def test_weighted(client, zone):
    w = {"name": "w", "type": "A", "values": ["1.1.1.1"], "routing_policy": "weighted", "weight": 10}
    assert client.post(url(zone), json=w).status_code == 422  # missing record ID
    assert client.post(url(zone), json={**w, "set_identifier": "one"}).status_code == 201
    assert client.post(url(zone), json={**w, "set_identifier": "two"}).status_code == 201
    assert client.post(url(zone), json={**w, "set_identifier": "two"}).status_code == 409
    assert client.post(url(zone), json={"name": "w", "type": "A", "values": ["2.2.2.2"]}).status_code == 409


def test_update_and_delete(client, zone):
    rid = client.post(url(zone), json={"name": "www", "type": "A", "values": ["1.1.1.1"]}).json()["id"]
    r = client.patch(url(zone, rid), json={"ttl": 3600, "values": ["1.1.1.1", "2.2.2.2"]})
    assert r.json()["ttl"] == 3600 and r.json()["values"] == ["1.1.1.1", "2.2.2.2"]
    assert client.patch(url(zone, rid), json={"values": ["nope"]}).status_code == 422
    assert client.get(url(zone, rid)).json()["ttl"] == 3600
    assert client.delete(url(zone, rid)).status_code == 204
    assert client.get(url(zone, rid)).status_code == 404
    assert client.delete(url(zone, rid)).status_code == 404
    assert client.get("/api/hosted-zones/ZNOPE/records").status_code == 404


def test_protected_records(client, zone):
    items = client.get(url(zone)).json()["items"]
    soa = next(r for r in items if r["type"] == "SOA")
    assert client.delete(url(zone, soa["id"])).status_code == 400
    assert client.patch(url(zone, soa["id"]), json={"ttl": 60}).status_code == 200


def test_filter_sort_paginate(client, zone):
    for i in range(30):
        client.post(url(zone), json={"name": f"h{i:02d}", "type": "A", "values": [f"10.0.0.{i}"]})
    r = client.get(url(zone), params={"type": "A", "page_size": 10, "page": 3}).json()
    assert r["total"] == 30 and r["items"][0]["name"] == "h20.example.com."
    assert client.get(url(zone), params={"q": "h1"}).json()["total"] == 10
    assert client.get(url(zone)).json()["items"][0]["name"] == "example.com."  # apex first


def test_cascade_delete_and_persistence(client, zone):
    client.delete(f"/api/hosted-zones/{zone['id']}")
    with SessionLocal() as db:  # fresh connection reads from the SQLite file
        assert db.query(RecordSet).count() == 0


def test_routing_policy_and_alias_filters(client, zone):
    client.post(url(zone), json={"name": "s", "type": "A", "values": ["1.1.1.1"]})
    client.post(
        url(zone),
        json={
            "name": "w",
            "type": "A",
            "values": ["1.1.1.2"],
            "routing_policy": "weighted",
            "set_identifier": "a",
            "weight": 1,
        },
    )
    weighted = client.get(url(zone), params={"routing_policy": "weighted"}).json()
    assert [r["name"] for r in weighted["items"]] == ["w.example.com."]
    assert client.get(url(zone), params={"routing_policy": "simple"}).json()["total"] == 3  # SOA, NS, s
    assert client.get(url(zone), params={"alias": "yes"}).json()["total"] == 0
    assert client.get(url(zone), params={"alias": "no"}).json()["total"] == 4
