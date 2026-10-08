"""Alias records, every routing policy, health checks, CIDR collections, multi-VPC zones."""

from sqlalchemy import create_engine, text

from app import migrate
from app.db import DATABASE_URL, SessionLocal


def url(zone, rid=""):
    return f"/api/hosted-zones/{zone['id']}/records" + (f"/{rid}" if rid != "" else "")


def health_check(client, **kw):
    r = client.post(
        "/api/health-checks", json={"ip_address": "192.0.2.10", **kw} if "domain_name" not in kw else kw
    )
    assert r.status_code == 201, r.text
    return r.json()


def rec(client, zone, **kw):
    body = {"name": "app", "type": "A", "values": ["192.0.2.1"], **kw}
    return client.post(url(zone), json=body)


# --- health checks ---------------------------------------------------------------------------


def test_health_check_crud_and_validation(client):
    hc = health_check(client, name="web", protocol="HTTPS", resource_path="health")
    assert hc["port"] == 443 and hc["resource_path"] == "/health"
    assert hc["endpoint"] == "https://192.0.2.10:443/health"
    assert hc["status"] in ("Unknown", "Healthy")

    tcp = health_check(client, domain_name="Example.COM.", protocol="TCP", port=5432)
    assert tcp["endpoint"] == "example.com:5432" and tcp["resource_path"] is None

    bad = [
        {},  # neither IP nor domain
        {"ip_address": "192.0.2.1", "domain_name": "a.com"},  # both
        {"ip_address": "10.0.0.1"},  # private
        {"ip_address": "999.1.1.1"},
        {"domain_name": "bad name"},
        {"ip_address": "192.0.2.1", "request_interval": 15},
        {"ip_address": "192.0.2.1", "failure_threshold": 11},
    ]
    for body in bad:
        assert client.post("/api/health-checks", json=body).status_code == 422, body

    r = client.put(f"/api/health-checks/{hc['id']}", json={"ip_address": "198.51.100.5", "name": "web2"})
    assert r.json()["name"] == "web2" and r.json()["protocol"] == "HTTP"
    assert client.get("/api/health-checks", params={"q": "web2"}).json()["total"] == 1
    assert client.delete(f"/api/health-checks/{tcp['id']}").status_code == 204
    assert client.get(f"/api/health-checks/{tcp['id']}").status_code == 404


def test_health_check_in_use_cant_be_deleted(client, zone):
    hc = health_check(client)
    r = rec(
        client,
        zone,
        routing_policy="failover",
        set_identifier="p",
        failover="PRIMARY",
        health_check_id=hc["id"],
    )
    assert r.status_code == 201 and r.json()["health_check_id"] == hc["id"]
    assert client.delete(f"/api/health-checks/{hc['id']}").status_code == 409
    client.patch(url(zone, r.json()["id"]), json={"health_check_id": None})
    assert client.delete(f"/api/health-checks/{hc['id']}").status_code == 204


def test_simple_records_cant_have_health_checks(client, zone):
    hc = health_check(client)
    r = rec(client, zone, health_check_id=hc["id"])
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "health_check_id"
    assert (
        rec(
            client, zone, routing_policy="weighted", set_identifier="a", weight=1, health_check_id="nope"
        ).status_code
        == 422
    )


# --- routing policies ------------------------------------------------------------------------


def test_failover_primary_and_secondary(client, zone):
    base = {"routing_policy": "failover"}
    assert rec(client, zone, **base, set_identifier="p").status_code == 422  # failover role missing
    assert rec(client, zone, **base, set_identifier="p", failover="PRIMARY").status_code == 201
    r = rec(client, zone, **base, set_identifier="p2", failover="PRIMARY")
    assert r.status_code == 409 and r.json()["errors"][0]["field"] == "failover"
    assert (
        rec(client, zone, **base, set_identifier="s", failover="SECONDARY", values=["192.0.2.2"]).status_code
        == 201
    )


def test_latency_geolocation_geoproximity(client, zone):
    lat = rec(
        client, zone, name="lat", routing_policy="latency", set_identifier="syd", region="ap-southeast-2"
    )
    assert lat.status_code == 201 and lat.json()["region"] == "ap-southeast-2"
    assert (
        rec(
            client, zone, name="lat", routing_policy="latency", set_identifier="x", region="mars-1"
        ).status_code
        == 422
    )

    def geo(loc, sid):
        return rec(
            client, zone, name="geo", routing_policy="geolocation", set_identifier=sid, geo_location=loc
        )

    for i, loc in enumerate(["*", "continent:EU", "country:US", "country:US/CA"]):
        assert geo(loc, f"g{i}").status_code == 201, loc
    assert geo("country:US", "dup").status_code == 409  # same location twice
    for bad in ["continent:XX", "europe", "country:usa"]:
        assert geo(bad, "bad").status_code == 422, bad

    def prox(where, sid, bias=None):
        return rec(
            client,
            zone,
            name="prox",
            routing_policy="geoproximity",
            set_identifier=sid,
            geoproximity=where,
            bias=bias,
        )

    assert prox("region:us-east-1", "a", 20).json()["bias"] == 20
    assert prox("coordinates:47.61,-122.33", "b").json()["bias"] == 0
    for bad in ["coordinates:95,0", "region:moon-1", "somewhere"]:
        assert prox(bad, "c").status_code == 422, bad
    assert prox("region:us-east-1", "d", 100).status_code == 422


def test_multivalue_rules(client, zone):
    mv = {"name": "mv", "routing_policy": "multivalue"}
    assert rec(client, zone, **mv, set_identifier="1").status_code == 201
    assert rec(client, zone, **mv, set_identifier="2", values=["192.0.2.2", "192.0.2.3"]).status_code == 422
    assert (
        rec(
            client,
            zone,
            name="c",
            type="CNAME",
            values=["x.com"],
            routing_policy="multivalue",
            set_identifier="1",
        ).status_code
        == 422
    )


def test_ip_based_routing_with_cidr_collection(client, zone):
    c = client.post(
        "/api/cidr-collections",
        json={
            "name": "offices",
            "locations": [{"name": "sydney", "cidrs": ["203.0.113.0/24", "2001:db8::/48"]}],
        },
    )
    assert c.status_code == 201, c.text
    cid = c.json()["id"]
    ip = {"name": "ip", "routing_policy": "ip", "cidr_collection_id": cid}
    assert rec(client, zone, **ip, set_identifier="syd", cidr_location="sydney").status_code == 201
    assert rec(client, zone, **ip, set_identifier="def", cidr_location="*").status_code == 201
    assert rec(client, zone, **ip, set_identifier="x", cidr_location="tokyo").status_code == 422

    # Locations and collections in use are protected.
    r = client.put(f"/api/cidr-collections/{cid}", json={"name": "offices", "locations": []})
    assert r.status_code == 409
    assert client.delete(f"/api/cidr-collections/{cid}").status_code == 409


def test_cidr_collection_validation(client):
    ok = client.post("/api/cidr-collections", json={"name": "a", "locations": []})
    assert ok.status_code == 201
    assert client.post("/api/cidr-collections", json={"name": "a"}).status_code == 409
    bad = [
        {"name": "bad name"},
        {"name": "b", "locations": [{"name": "x", "cidrs": ["192.0.2.1/24"]}]},  # host bits set
        {"name": "b", "locations": [{"name": "x", "cidrs": ["nope"]}]},
        {
            "name": "b",
            "locations": [
                {"name": "x", "cidrs": ["192.0.2.0/24"]},
                {"name": "x", "cidrs": ["198.51.100.0/24"]},
            ],
        },
    ]
    for body in bad:
        assert client.post("/api/cidr-collections", json=body).status_code == 422, body
    r = client.put(
        f"/api/cidr-collections/{ok.json()['id']}",
        json={"name": "a2", "locations": [{"name": "l1", "cidrs": ["192.0.2.0/24"]}]},
    )
    assert r.json()["name"] == "a2" and r.json()["locations"][0]["cidrs"] == ["192.0.2.0/24"]
    assert client.delete(f"/api/cidr-collections/{ok.json()['id']}").status_code == 204


def test_policy_fields_from_other_policies_are_rejected_on_edit(client, zone):
    r = rec(client, zone, routing_policy="latency", set_identifier="a", region="us-east-1")
    rid = r.json()["id"]
    assert client.patch(url(zone, rid), json={"weight": 5}).status_code == 422
    assert client.patch(url(zone, rid), json={"region": "eu-west-1"}).json()["region"] == "eu-west-1"
    assert client.patch(url(zone, rid), json={"region": "nowhere"}).status_code == 422


# --- alias records ---------------------------------------------------------------------------


def test_alias_to_aws_resource(client, zone):
    r = client.post(
        url(zone),
        json={
            "name": "",
            "type": "A",
            "alias": {
                "target_type": "elb",
                "dns_name": "my-lb-1234.ap-southeast-2.elb.amazonaws.com",
                "region": "ap-southeast-2",
                "evaluate_target_health": True,
            },
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ttl"] is None and body["values"] == []
    assert body["alias"]["dns_name"] == "my-lb-1234.ap-southeast-2.elb.amazonaws.com."
    assert body["alias"]["evaluate_target_health"] is True

    # Filter by alias
    assert client.get(url(zone), params={"alias": "yes"}).json()["total"] == 1
    assert client.get(url(zone), params={"alias": "no"}).json()["total"] == 2

    def alias(**kw):
        return client.post(
            url(zone),
            json={
                "name": "x",
                "type": "A",
                "alias": {"target_type": "cloudfront", "dns_name": "d1.cloudfront.net", **kw},
            },
        )

    assert alias().status_code == 201
    assert (
        client.post(
            url(zone),
            json={"name": "y", "type": "TXT", "alias": {"target_type": "cloudfront", "dns_name": "d.net"}},
        ).status_code
        == 422
    )
    assert (
        client.post(
            url(zone),
            json={"name": "z", "type": "A", "alias": {"target_type": "elb", "dns_name": "lb.example.com"}},
        ).status_code
        == 422
    )  # region missing
    assert (
        client.post(
            url(zone),
            json={
                "name": "w",
                "type": "A",
                "alias": {"target_type": "s3", "dns_name": "bad name", "region": "us-east-1"},
            },
        ).status_code
        == 422
    )


def test_alias_to_record_in_same_zone(client, zone):
    client.post(url(zone), json={"name": "www", "type": "A", "values": ["192.0.2.1"]})
    ok = client.post(
        url(zone), json={"name": "app", "type": "A", "alias": {"target_type": "record", "dns_name": "www"}}
    )
    assert ok.status_code == 201 and ok.json()["alias"]["dns_name"] == "www.example.com."
    missing = client.post(
        url(zone), json={"name": "b", "type": "A", "alias": {"target_type": "record", "dns_name": "nothere"}}
    )
    assert missing.status_code == 422
    itself = client.post(
        url(zone), json={"name": "c", "type": "A", "alias": {"target_type": "record", "dns_name": "c"}}
    )
    assert itself.status_code == 422


def test_switch_record_between_alias_and_values(client, zone):
    rid = client.post(url(zone), json={"name": "s", "type": "A", "values": ["192.0.2.1"]}).json()["id"]
    r = client.patch(
        url(zone, rid), json={"alias": {"target_type": "cloudfront", "dns_name": "d.cloudfront.net"}}
    )
    assert r.json()["alias"] and r.json()["values"] == []
    assert client.patch(url(zone, rid), json={"alias": None}).status_code == 422  # needs values again
    r = client.patch(url(zone, rid), json={"alias": None, "values": ["192.0.2.9"], "ttl": 60})
    assert r.json()["alias"] is None and r.json()["values"] == ["192.0.2.9"] and r.json()["ttl"] == 60


# --- private zones with several VPCs ---------------------------------------------------------


def test_private_zone_with_several_vpcs(client):
    vpcs = [
        {"region": "us-east-1", "vpc_id": "vpc-0a1b2c3d"},
        {"region": "eu-west-1", "vpc_id": "vpc-0e1f2a3b"},
    ]
    r = client.post("/api/hosted-zones", json={"name": "corp.internal", "zone_type": "private", "vpcs": vpcs})
    assert r.status_code == 201 and r.json()["vpcs"] == vpcs and r.json()["vpc_id"] == "vpc-0a1b2c3d"
    zid = r.json()["id"]

    r = client.patch(f"/api/hosted-zones/{zid}", json={"vpcs": vpcs[1:]})
    assert r.json()["vpcs"] == vpcs[1:]
    assert client.patch(f"/api/hosted-zones/{zid}", json={"vpcs": []}).status_code == 422
    assert (
        client.patch(f"/api/hosted-zones/{zid}", json={"vpcs": vpcs + vpcs[:1]}).status_code == 422
    )  # duplicate
    pub = client.post("/api/hosted-zones", json={"name": "pub.com"}).json()
    assert client.patch(f"/api/hosted-zones/{pub['id']}", json={"vpcs": vpcs}).status_code == 422


def test_account_details_for_the_menu(client):
    me = client.get("/api/auth/me").json()
    assert me == {
        "username": "demo",
        "account_name": "Demo Organization",
        "account_id": "123456789012",
        "role": "developer",
    }


# --- startup migration -----------------------------------------------------------------------


def test_migration_adds_columns_and_copies_old_vpc(client):
    # Simulate a database from before these features: drop the new columns and VPC rows,
    # put the VPC back on the zone row, then run the migration.
    client.post(
        "/api/hosted-zones",
        json={
            "name": "old.internal",
            "zone_type": "private",
            "vpcs": [{"region": "us-east-1", "vpc_id": "vpc-0a1b2c3d"}],
        },
    )
    with SessionLocal() as db:
        db.execute(text("DELETE FROM zone_vpcs"))
        db.execute(
            text(
                "UPDATE hosted_zones SET vpc_region='us-east-1', vpc_id='vpc-0a1b2c3d' WHERE zone_type='private'"
            )
        )
        db.execute(text("ALTER TABLE record_sets DROP COLUMN alias_target"))
        db.commit()
    engine = create_engine(DATABASE_URL)
    migrate.upgrade(engine)
    migrate.upgrade(engine)  # idempotent
    engine.dispose()
    zones = client.get("/api/hosted-zones", params={"q": "old.internal"}).json()["items"]
    assert zones[0]["vpcs"] == [{"region": "us-east-1", "vpc_id": "vpc-0a1b2c3d"}]
    with SessionLocal() as db:
        cols = [r[1] for r in db.execute(text("PRAGMA table_info(record_sets)"))]
    assert "alias_target" in cols
