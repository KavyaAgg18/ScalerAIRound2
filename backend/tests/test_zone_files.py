import json

from app.zonefile import parse_zone_file

ZONE_FILE = """\
$ORIGIN example.com.
$TTL 3600
; Route 53 keeps its own apex SOA and NS, so these two are skipped
@   IN  SOA ns1.other.net. admin.example.com. (
            2024010101 ; serial
            7200 900 1209600 86400 )
@       IN  NS  ns1.other.net.
@           MX  10 mail1.example.com.
            MX  20 mail2.example.com.
www     300 IN  A   192.0.2.1
www     IN  300 A   192.0.2.2
api         CNAME   lb.example.net.
@           TXT "v=spf1 include:amazonses.com ~all" ; trailing comment
_sip._tcp   SRV 1 10 5060 sip.example.com.
@           CAA 0 issue "amazon.com"
ipv6        AAAA 2001:db8::1
sub         NS  ns.sub-provider.net.
1.2.0.192.in-addr.arpa. PTR host.example.com.
"""


def url(zone, path):
    return f"/api/hosted-zones/{zone['id']}/{path}"


def test_parser_handles_directives_continuations_and_defaults():
    result = parse_zone_file(ZONE_FILE, "example.com.")
    assert result.errors == ["Line 18: 1.2.0.192.in-addr.arpa. isn't in the hosted zone example.com."]
    assert result.skipped == 2
    by_key = {(r.name, r.type, r.value): r.ttl for r in result.records}
    assert by_key[("www.example.com.", "A", "192.0.2.2")] == 300  # TTL before class
    assert by_key[("example.com.", "MX", "20 mail2.example.com.")] == 3600  # owner carried over, $TTL used
    assert ("example.com.", "TXT", '"v=spf1 include:amazonses.com ~all"') in by_key


def test_import_creates_record_sets(client, zone):
    text = ZONE_FILE.replace("1.2.0.192.in-addr.arpa. PTR host.example.com.\n", "ptr PTR host.example.com.\n")
    r = client.post(url(zone, "import"), json={"zone_file": text})
    assert r.status_code == 200, r.text
    assert r.json() == {"imported": 9, "skipped": 2}

    items = client.get(url(zone, "records"), params={"page_size": 100}).json()["items"]
    sets = {(i["name"], i["type"]): i for i in items}
    assert sets[("www.example.com.", "A")]["values"] == ["192.0.2.1", "192.0.2.2"]
    assert sets[("example.com.", "MX")]["values"] == ["10 mail1.example.com.", "20 mail2.example.com."]
    assert sets[("example.com.", "SOA")]["is_protected"]  # original SOA untouched
    assert len(items) == 11


def test_import_reports_every_problem_and_imports_nothing(client, zone):
    text = "www A 999.1.1.1\nmail MX mail.example.com\nx TYPE99 abc\n$INCLUDE other.zone\nok A 1.1.1.1\n"
    r = client.post(url(zone, "import"), json={"zone_file": text})
    assert r.status_code == 422
    messages = [e["message"] for e in r.json()["errors"]]
    assert len(messages) == 4
    assert any("TYPE99 isn't supported" in m for m in messages)
    assert any("$INCLUDE" in m for m in messages)
    assert any("999.1.1.1" in m for m in messages)
    assert client.get(url(zone, "records")).json()["total"] == 2


def test_import_is_all_or_nothing_on_conflicts(client, zone):
    client.post(url(zone, "records"), json={"name": "www", "type": "A", "values": ["192.0.2.9"]})
    r = client.post(url(zone, "import"), json={"zone_file": "new A 1.1.1.1\nwww A 1.1.1.2\n"})
    assert r.status_code == 409
    assert "Line 2" in r.json()["errors"][0]["message"]
    names = [i["name"] for i in client.get(url(zone, "records")).json()["items"]]
    assert "new.example.com." not in names


def test_import_rejects_mixed_ttls_and_empty_files(client, zone):
    r = client.post(url(zone, "import"), json={"zone_file": "www 60 A 1.1.1.1\nwww 300 A 1.1.1.2\n"})
    assert r.status_code == 422 and "same TTL" in r.json()["errors"][0]["message"]
    r = client.post(url(zone, "import"), json={"zone_file": "; only a comment\n"})
    assert r.status_code == 422 and "doesn't contain any records" in r.json()["detail"]


def test_export_bind_round_trips_into_another_zone(client, zone):
    client.post(url(zone, "records"), json={"name": "www", "type": "A", "values": ["192.0.2.1", "192.0.2.2"]})
    client.post(url(zone, "records"), json={"name": "", "type": "TXT", "values": ['"hello; world"']})
    r = client.get(url(zone, "export"))
    assert r.status_code == 200
    assert r.headers["content-disposition"] == 'attachment; filename="example.com.zone"'
    text = r.text
    assert text.startswith("$ORIGIN example.com.")
    assert "www.example.com.\t300\tIN\tA\t192.0.2.2" in text

    # Same names under a different origin: import into a copy of the zone.
    copy = client.post("/api/hosted-zones", json={"name": "copy.com"}).json()
    renamed = text.replace("example.com.", "copy.com.")
    r = client.post(url(copy, "import"), json={"zone_file": renamed})
    assert r.status_code == 200, r.text
    assert r.json() == {"imported": 2, "skipped": 5}  # SOA + four NS lines
    txt = client.get(url(copy, "records"), params={"type": "TXT"}).json()["items"][0]
    assert txt["values"] == ['"hello; world"']  # ; inside quotes isn't a comment


def test_export_json(client, zone):
    client.post(
        url(zone, "records"),
        json={
            "name": "w",
            "type": "A",
            "values": ["1.1.1.1"],
            "routing_policy": "weighted",
            "set_identifier": "a",
            "weight": 5,
        },
    )
    r = client.get(url(zone, "export"), params={"format": "json"})
    assert r.headers["content-disposition"] == 'attachment; filename="example.com.json"'
    data = json.loads(r.text)
    assert data["hosted_zone"]["name"] == "example.com."
    weighted = next(x for x in data["records"] if x["name"] == "w.example.com.")
    assert weighted["weight"] == 5 and weighted["set_identifier"] == "a"
    assert client.get(url(zone, "export"), params={"format": "xml"}).status_code == 422


def test_import_export_need_auth_and_a_real_zone(client, anon):
    assert client.post("/api/hosted-zones/ZNOPE/import", json={"zone_file": "a A 1.1.1.1"}).status_code == 404
    assert client.get("/api/hosted-zones/ZNOPE/export").status_code == 404
    client.post("/api/auth/logout")
    assert client.get("/api/hosted-zones/ZNOPE/export").status_code == 401


def test_export_includes_alias_and_policy_records(client, zone):
    client.post(
        url(zone, "records"),
        json={
            "name": "cdn",
            "type": "A",
            "alias": {"target_type": "cloudfront", "dns_name": "d1.cloudfront.net"},
        },
    )
    client.post(
        url(zone, "records"),
        json={
            "name": "lat",
            "type": "A",
            "values": ["192.0.2.1"],
            "routing_policy": "latency",
            "set_identifier": "syd",
            "region": "ap-southeast-2",
        },
    )
    bind = client.get(url(zone, "export")).text
    assert "; alias cdn.example.com. A -> d1.cloudfront.net." in bind
    assert "lat.example.com.\t300\tIN\tA\t192.0.2.1\t; latency routing, record ID syd" in bind
    records = json.loads(client.get(url(zone, "export"), params={"format": "json"}).text)["records"]
    cdn = next(r for r in records if r["name"] == "cdn.example.com.")
    assert cdn["alias"]["target_type"] == "cloudfront" and "ttl" not in cdn
    lat = next(r for r in records if r["name"] == "lat.example.com.")
    assert lat["region"] == "ap-southeast-2"
