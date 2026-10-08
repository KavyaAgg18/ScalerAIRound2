import random
import re
import secrets
import string
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .aws import REGIONS
from .db import get_db
from .dns_validate import normalize_zone_name
from .errors import ApiError
from .models import HostedZone, RecordSet, ZoneTag, ZoneVpc
from .schemas import Page, Tag, Vpc, ZoneCreate, ZoneOut, ZoneUpdate

router = APIRouter(prefix="/api/hosted-zones", tags=["hosted-zones"], dependencies=[Depends(current_user)])

SOA_TTL = 900
NS_TTL = 172800


def new_zone_id() -> str:
    return "Z" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(20))


def fake_name_servers() -> list[str]:
    # Mimics Route 53's delegation set format; these servers don't answer queries.
    servers = []
    for tld in ("com", "net", "org", "co.uk"):
        n = random.randint(0, 2047)
        servers.append(f"ns-{n}.awsdns-{n // 32:02d}.{tld}.")
    return servers


def default_records(zone: HostedZone) -> list[RecordSet]:
    ns = fake_name_servers()
    soa = RecordSet(name=zone.name, type="SOA", ttl=SOA_TTL, is_protected=True)
    soa.values = [f"{ns[0]} awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400"]
    nsr = RecordSet(name=zone.name, type="NS", ttl=NS_TTL, is_protected=True)
    nsr.values = ns
    return [nsr, soa]


VPC_ID = re.compile(r"^vpc-[0-9a-f]{8,17}$")


def make_tags(tags: list[Tag]) -> list[ZoneTag]:
    keys = [t.key.strip() for t in tags]
    if len(set(keys)) != len(keys):
        raise ApiError(422, "Each tag key must be unique.", "tags")
    if any(k.lower().startswith("aws:") for k in keys):
        raise ApiError(422, 'Tag keys can\'t start with "aws:".', "tags")
    return [ZoneTag(key=t.key.strip(), value=t.value.strip()) for t in tags]


def make_vpcs(vpcs: list[Vpc]) -> list[ZoneVpc]:
    if not vpcs:
        raise ApiError(422, "Associate at least one VPC with a private hosted zone.", "vpcs")
    seen: set[str] = set()
    out = []
    for v in vpcs:
        vpc_id = v.vpc_id.strip()
        if v.region not in REGIONS:
            raise ApiError(422, "Choose a Region for each VPC.", "vpcs")
        if not VPC_ID.match(vpc_id):
            raise ApiError(422, f"{vpc_id!r} isn't a VPC ID. Enter one like vpc-0a1b2c3d4e5f67890.", "vpcs")
        if vpc_id in seen:
            raise ApiError(422, f"{vpc_id} is listed more than once.", "vpcs")
        seen.add(vpc_id)
        out.append(ZoneVpc(region=v.region, vpc_id=vpc_id))
    return out


def record_count_subq():
    return (
        select(func.count(RecordSet.id))
        .where(RecordSet.hosted_zone_id == HostedZone.id)
        .correlate(HostedZone)
        .scalar_subquery()
    )


def to_out(zone: HostedZone, record_count: int, db: DbSession) -> ZoneOut:
    ns = db.scalar(
        select(RecordSet).where(
            RecordSet.hosted_zone_id == zone.id, RecordSet.name == zone.name, RecordSet.type == "NS"
        )
    )
    vpcs = [{"region": v.region, "vpc_id": v.vpc_id} for v in zone.vpcs]
    fields = {
        f: getattr(zone, f) for f in ("id", "name", "zone_type", "description", "created_at", "updated_at")
    }
    return ZoneOut.model_validate(
        fields
        | {
            "vpcs": vpcs,
            "vpc_region": vpcs[0]["region"] if vpcs else None,
            "vpc_id": vpcs[0]["vpc_id"] if vpcs else None,
            "record_count": record_count,
            "name_servers": ns.values if ns else [],
            "tags": zone.tags,
        }
    )


def get_zone_or_404(db: DbSession, zone_id: str) -> HostedZone:
    zone = db.get(HostedZone, zone_id)
    if not zone:
        raise ApiError(404, f"No hosted zone found with ID: {zone_id}")
    return zone


def _zone_out(db: DbSession, zone: HostedZone) -> ZoneOut:
    count = db.scalar(select(func.count(RecordSet.id)).where(RecordSet.hosted_zone_id == zone.id))
    return to_out(zone, count, db)


@router.get("", response_model=Page[ZoneOut])
def list_zones(
    db: DbSession = Depends(get_db),
    q: str = "",
    sort: Literal["name", "zone_type", "record_count", "description", "id", "created_at"] = "name",
    order: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
):
    count_col = record_count_subq().label("record_count")
    stmt = select(HostedZone, count_col)
    if q := q.strip().lower():
        like = f"%{q}%"
        stmt = stmt.where(
            HostedZone.name.like(like) | HostedZone.description.ilike(like) | HostedZone.id.ilike(like)
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    sort_col = count_col if sort == "record_count" else getattr(HostedZone, sort)
    stmt = stmt.order_by(sort_col.desc() if order == "desc" else sort_col.asc(), HostedZone.name)
    rows = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=[to_out(z, c, db) for z, c in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=ZoneOut, status_code=201)
def create_zone(body: ZoneCreate, db: DbSession = Depends(get_db)):
    try:
        name = normalize_zone_name(body.name)
    except ValueError as e:
        raise ApiError(422, str(e), "name") from None
    if db.scalar(select(HostedZone).where(HostedZone.name == name)):
        raise ApiError(409, f"A hosted zone named {name.rstrip('.')} already exists.", "name")
    vpcs = []
    if body.zone_type == "private":
        requested = list(body.vpcs)
        if body.vpc_id or body.vpc_region:  # single-VPC form from older clients
            requested.append(Vpc(region=body.vpc_region or "", vpc_id=body.vpc_id or ""))
        vpcs = make_vpcs(requested)
    zone = HostedZone(
        id=new_zone_id(), name=name, zone_type=body.zone_type, description=body.description.strip()
    )
    zone.records = default_records(zone)
    zone.tags = make_tags(body.tags)
    zone.vpcs = vpcs
    db.add(zone)
    db.commit()
    return _zone_out(db, zone)


@router.get("/{zone_id}", response_model=ZoneOut)
def get_zone(zone_id: str, db: DbSession = Depends(get_db)):
    return _zone_out(db, get_zone_or_404(db, zone_id))


@router.patch("/{zone_id}", response_model=ZoneOut)
def update_zone(zone_id: str, body: ZoneUpdate, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(db, zone_id)
    if body.description is not None:
        zone.description = body.description.strip()
    if body.tags is not None:
        new_tags = make_tags(body.tags)
        # Remove the old tags first; otherwise re-adding an existing key hits the unique constraint.
        zone.tags.clear()
        db.flush()
        zone.tags = new_tags
    if body.vpcs is not None:
        if zone.zone_type != "private":
            raise ApiError(422, "Only private hosted zones are associated with VPCs.", "vpcs")
        new_vpcs = make_vpcs(body.vpcs)
        zone.vpcs.clear()
        db.flush()
        zone.vpcs = new_vpcs
    db.commit()
    return _zone_out(db, zone)


@router.delete("/{zone_id}", status_code=204)
def delete_zone(zone_id: str, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(db, zone_id)
    extra = db.scalar(
        select(func.count(RecordSet.id)).where(
            RecordSet.hosted_zone_id == zone.id, RecordSet.is_protected.is_(False)
        )
    )
    if extra:
        raise ApiError(
            409,
            f"The hosted zone {zone.name.rstrip('.')} contains {extra} record(s) other than the default SOA and NS "
            "records. Delete those records first, then delete the hosted zone.",
        )
    db.delete(zone)
    db.commit()
