import os

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from .auth import hash_password
from .models import HostedZone, RecordSet, User, ZoneVpc
from .zones import default_records, new_zone_id

DEMO_USERNAME = os.environ.get("DEMO_USERNAME", "demo")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo1234")

DEMO_ZONES = [
    (
        "example.com.",
        "public",
        "Company website",
        [
            ("www.example.com.", "A", 300, ["192.0.2.10", "192.0.2.11"]),
            ("api.example.com.", "CNAME", 300, ["api-lb-123456.us-east-1.elb.amazonaws.com"]),
            ("example.com.", "MX", 3600, ["10 mail1.example.com", "20 mail2.example.com"]),
            ("example.com.", "TXT", 300, ['"v=spf1 include:amazonses.com ~all"']),
        ],
    ),
    (
        "demo-app.net.",
        "public",
        "",
        [
            ("demo-app.net.", "A", 60, ["198.51.100.7"]),
            ("ipv6.demo-app.net.", "AAAA", 300, ["2001:db8::7"]),
        ],
    ),
    (
        "internal.corp.",
        "private",
        "Internal services",
        [
            ("db.internal.corp.", "A", 300, ["10.0.1.25"]),
        ],
    ),
]


def seed(db: DbSession) -> None:
    # Only ever inserts. Safe to run on every startup.
    if not db.scalar(select(User).where(User.username == DEMO_USERNAME)):
        db.add(User(username=DEMO_USERNAME, password_hash=hash_password(DEMO_PASSWORD)))

    if os.environ.get("SEED_DEMO_DATA", "1") == "1" and not db.scalar(select(HostedZone.id).limit(1)):
        for name, zone_type, desc, records in DEMO_ZONES:
            zone = HostedZone(id=new_zone_id(), name=name, zone_type=zone_type, description=desc)
            if zone_type == "private":
                zone.vpcs = [ZoneVpc(region="us-east-1", vpc_id="vpc-0a1b2c3d4e5f67890")]
            zone.records = default_records(zone)
            for rname, rtype, ttl, values in records:
                r = RecordSet(name=rname, type=rtype, ttl=ttl)
                r.values = values
                zone.records.append(r)
            db.add(zone)
    db.commit()
