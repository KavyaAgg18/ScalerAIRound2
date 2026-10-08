def test_create_zone_adds_soa_and_ns(client, zone):
    assert zone["id"].startswith("Z") and len(zone["id"]) == 21
    assert zone["name"] == "example.com."
    assert zone["record_count"] == 2
    assert len(zone["name_servers"]) == 4
    types = {r["type"] for r in client.get(f"/api/hosted-zones/{zone['id']}/records").json()["items"]}
    assert types == {"SOA", "NS"}


def test_duplicate_and_invalid(client, zone):
    r = client.post("/api/hosted-zones", json={"name": "EXAMPLE.com"})
    assert r.status_code == 409 and r.json()["errors"][0]["field"] == "name"
    for bad in ["", "com", "-bad.com", "bad_label.com", "a" * 64 + ".com"]:
        assert client.post("/api/hosted-zones", json={"name": bad}).status_code == 422, bad


def test_private_zone_requires_vpc(client):
    r = client.post("/api/hosted-zones", json={"name": "corp.internal", "zone_type": "private"})
    assert r.status_code == 422
    r = client.post(
        "/api/hosted-zones",
        json={
            "name": "corp.internal",
            "zone_type": "private",
            "vpc_region": "us-east-1",
            "vpc_id": "vpc-0a1b2c3d",
        },
    )
    assert r.status_code == 201 and r.json()["vpc_id"] == "vpc-0a1b2c3d"


def test_list_search_sort_paginate(client):
    for i in range(12):
        client.post("/api/hosted-zones", json={"name": f"site{i:02d}.com"})
    r = client.get("/api/hosted-zones", params={"page_size": 5, "page": 3}).json()
    assert r["total"] == 12 and [z["name"] for z in r["items"]] == ["site10.com.", "site11.com."]
    r = client.get("/api/hosted-zones", params={"q": "SITE0", "sort": "name", "order": "desc"}).json()
    assert r["total"] == 10 and r["items"][0]["name"] == "site09.com."
    assert client.get("/api/hosted-zones", params={"sort": "bogus"}).status_code == 422


def test_update_get_delete(client, zone):
    zid = zone["id"]
    r = client.patch(f"/api/hosted-zones/{zid}", json={"description": "new"})
    assert r.json()["description"] == "new"
    rec = client.post(
        f"/api/hosted-zones/{zid}/records", json={"name": "www", "type": "A", "values": ["1.2.3.4"]}
    )
    assert client.delete(f"/api/hosted-zones/{zid}").status_code == 409
    client.delete(f"/api/hosted-zones/{zid}/records/{rec.json()['id']}")
    assert client.delete(f"/api/hosted-zones/{zid}").status_code == 204
    assert client.get(f"/api/hosted-zones/{zid}").status_code == 404
    assert client.delete(f"/api/hosted-zones/{zid}").status_code == 404


def test_private_zone_rejects_malformed_vpc_id(client):
    body = {"name": "corp.internal", "zone_type": "private", "vpc_region": "us-east-1", "vpc_id": "my-vpc"}
    r = client.post("/api/hosted-zones", json=body)
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "vpcs"


def test_tags_on_create_and_edit(client):
    r = client.post(
        "/api/hosted-zones",
        json={"name": "tagged.com", "tags": [{"key": "env", "value": "prod"}, {"key": "team"}]},
    )
    assert r.status_code == 201
    assert r.json()["tags"] == [{"key": "env", "value": "prod"}, {"key": "team", "value": ""}]
    zid = r.json()["id"]

    # Editing tags replaces the whole set; description is untouched when omitted.
    r = client.patch(f"/api/hosted-zones/{zid}", json={"tags": [{"key": "env", "value": "dev"}]})
    assert r.json()["tags"] == [{"key": "env", "value": "dev"}]
    r = client.patch(f"/api/hosted-zones/{zid}", json={"description": "x"})
    assert r.json()["tags"] == [{"key": "env", "value": "dev"}] and r.json()["description"] == "x"

    dup = client.patch(f"/api/hosted-zones/{zid}", json={"tags": [{"key": "a"}, {"key": "a"}]})
    assert dup.status_code == 422 and dup.json()["errors"][0]["field"] == "tags"
    reserved = client.post("/api/hosted-zones", json={"name": "t2.com", "tags": [{"key": "aws:x"}]})
    assert reserved.status_code == 422
    too_many = [{"key": f"k{i}"} for i in range(51)]
    assert client.post("/api/hosted-zones", json={"name": "t3.com", "tags": too_many}).status_code == 422
