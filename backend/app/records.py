import re
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .aws import ALIAS_TARGETS, CONTINENTS, REGIONS
from .db import get_db
from .dns_validate import is_hostname, record_fqdn, validate_ttl, validate_values
from .errors import ApiError
from .models import CidrCollection, HealthCheck, RecordSet
from .schemas import Alias, Page, PolicyFields, RecordCreate, RecordOut, RecordUpdate
from .zones import get_zone_or_404

router = APIRouter(
    prefix="/api/hosted-zones/{zone_id}/records", tags=["records"], dependencies=[Depends(current_user)]
)

POLICY_NAMES = {
    "simple": "simple",
    "weighted": "weighted",
    "failover": "failover",
    "latency": "latency",
    "geolocation": "geolocation",
    "geoproximity": "geoproximity",
    "multivalue": "multivalue answer",
    "ip": "IP-based",
}
POLICY_FIELDS = {
    "weighted": ["weight"],
    "failover": ["failover"],
    "latency": ["region"],
    "geolocation": ["geo_location"],
    "geoproximity": ["geoproximity", "bias"],
    "ip": ["cidr_collection_id", "cidr_location"],
}
ALL_POLICY_FIELDS = [f for fields in POLICY_FIELDS.values() for f in fields]

GEO_LOCATION = re.compile(r"^(\*|continent:[A-Z]{2}|country:[A-Z]{2}(/[A-Z0-9]{1,3})?)$")
COORDINATES = re.compile(r"^coordinates:(-?\d{1,2}(\.\d+)?),(-?\d{1,3}(\.\d+)?)$")


def _get_record(db: DbSession, zone_id: str, record_id: int) -> RecordSet:
    get_zone_or_404(db, zone_id)
    record = db.get(RecordSet, record_id)
    if not record or record.hosted_zone_id != zone_id:
        raise ApiError(404, f"No record found with ID {record_id} in hosted zone {zone_id}.")
    return record


def _validated(fn, field: str, *args):
    try:
        return fn(*args)
    except ValueError as e:
        raise ApiError(422, str(e), field) from None


def check_conflicts(
    db: DbSession,
    zone_id: str,
    name: str,
    rtype: str,
    policy: str,
    set_identifier: str | None,
    *,
    failover: str | None = None,
    geo_location: str | None = None,
    exclude_id: int | None = None,
) -> None:
    """Route 53's record-set rules: CNAME exclusivity, one policy per name/type, unique sets."""
    display = name.rstrip(".")
    same_name = db.scalars(
        select(RecordSet).where(RecordSet.hosted_zone_id == zone_id, RecordSet.name == name)
    ).all()
    for other in same_name:
        if other.id == exclude_id:
            continue
        if (rtype == "CNAME") != (other.type == "CNAME"):
            raise ApiError(
                409,
                f"A CNAME record can't coexist with other records named {display}. "
                f"A {other.type} record with that name already exists.",
                "name",
            )
        if other.type != rtype:
            continue
        if other.routing_policy != policy:
            raise ApiError(
                409,
                f"Records named {display} of type {rtype} already use the "
                f"{POLICY_NAMES.get(other.routing_policy, other.routing_policy)} routing policy. "
                "All records with the same name and type must use the same routing policy.",
                "routing_policy",
            )
        if policy == "simple":
            raise ApiError(
                409,
                f"A record named {display} with type {rtype} already exists. "
                "Edit the existing record to add values.",
                "name",
            )
        if other.set_identifier == set_identifier:
            raise ApiError(
                409,
                f'Record ID "{set_identifier}" is already used for {display} {rtype}.',
                "set_identifier",
            )
        if failover and other.failover == failover:
            raise ApiError(
                409,
                f"{display} {rtype} already has a {failover.lower()} failover record.",
                "failover",
            )
        if geo_location and other.geo_location == geo_location:
            raise ApiError(
                409,
                f"{display} {rtype} already has a geolocation record for this location.",
                "geo_location",
            )


def _check_policy(db: DbSession, policy: str, rtype: str, f: PolicyFields, values: list[str], alias) -> dict:
    """Validate the fields for one routing policy; returns the columns to store."""
    out = {k: None for k in ALL_POLICY_FIELDS} | {"set_identifier": None}

    if policy != "simple":
        if rtype == "NS":
            raise ApiError(
                422, "You can create NS records only with the simple routing policy.", "routing_policy"
            )
        set_identifier = (f.set_identifier or "").strip()
        if not set_identifier:
            raise ApiError(
                422,
                "Enter a record ID to differentiate records with the same name and type.",
                "set_identifier",
            )
        out["set_identifier"] = set_identifier

    if policy == "weighted":
        if f.weight is None:
            raise ApiError(422, "Enter a weight between 0 and 255.", "weight")
        out["weight"] = f.weight
    elif policy == "failover":
        if not f.failover:
            raise ApiError(422, "Choose whether this is the primary or the secondary record.", "failover")
        out["failover"] = f.failover
    elif policy == "latency":
        if f.region not in REGIONS:
            raise ApiError(422, "Choose the Region of the resource this record routes to.", "region")
        out["region"] = f.region
    elif policy == "geolocation":
        loc = (f.geo_location or "").strip()
        if not GEO_LOCATION.match(loc) or (loc.startswith("continent:") and loc[10:] not in CONTINENTS):
            raise ApiError(422, "Choose a location: Default, a continent, or a country.", "geo_location")
        out["geo_location"] = loc
    elif policy == "geoproximity":
        where = (f.geoproximity or "").strip()
        m = COORDINATES.match(where)
        if where.startswith("region:"):
            if where[7:] not in REGIONS:
                raise ApiError(422, "Choose an AWS Region for the resource.", "geoproximity")
        elif not m or not (-90 <= float(m.group(1)) <= 90 and -180 <= float(m.group(3)) <= 180):
            raise ApiError(
                422,
                "Choose an AWS Region, or enter coordinates as latitude (-90 to 90) and longitude (-180 to 180).",
                "geoproximity",
            )
        out["geoproximity"] = where
        out["bias"] = f.bias or 0
    elif policy == "multivalue":
        if rtype == "CNAME":
            raise ApiError(
                422, "Multivalue answer routing isn't available for CNAME records.", "routing_policy"
            )
        if alias:
            raise ApiError(422, "Multivalue answer records can't be alias records.", "alias")
        if len(values) != 1:
            raise ApiError(422, "Each multivalue answer record can have only one value.", "values")
    elif policy == "ip":
        collection = db.get(CidrCollection, f.cidr_collection_id or "")
        if not collection:
            raise ApiError(422, "Choose a CIDR collection.", "cidr_collection_id")
        names = {loc.name for loc in collection.locations} | {"*"}
        if f.cidr_location not in names:
            raise ApiError(
                422,
                f"Choose a location in the CIDR collection {collection.name}, or * for the default.",
                "cidr_location",
            )
        out["cidr_collection_id"] = collection.id
        out["cidr_location"] = f.cidr_location

    if f.health_check_id:
        if policy == "simple":
            raise ApiError(
                422, "Records that use simple routing can't have a health check.", "health_check_id"
            )
        if not db.get(HealthCheck, f.health_check_id):
            raise ApiError(422, "Choose an existing health check.", "health_check_id")
    out["health_check_id"] = f.health_check_id or None
    return out


def _check_alias(db: DbSession, zone, name: str, rtype: str, alias: Alias) -> dict:
    if alias.target_type == "record":
        target = record_fqdn(alias.dns_name, zone.name, rtype if rtype != "CNAME" else "A")
        if target == name:
            raise ApiError(422, "An alias record can't route traffic to itself.", "alias")
        exists = db.scalar(
            select(RecordSet.id).where(
                RecordSet.hosted_zone_id == zone.id, RecordSet.name == target, RecordSet.type == rtype
            )
        )
        if not exists:
            raise ApiError(
                422,
                f"No {rtype} record named {target.rstrip('.')} exists in this hosted zone to route traffic to.",
                "alias",
            )
        dns_name = target
    else:
        if rtype not in ("A", "AAAA"):
            raise ApiError(422, "Only A and AAAA records can be aliases to AWS resources.", "alias")
        if not is_hostname(alias.dns_name):
            raise ApiError(422, f'"{alias.dns_name}" isn\'t a valid DNS name for the alias target.', "alias")
        dns_name = alias.dns_name.strip().lower().rstrip(".") + "."
    needs_region = ALIAS_TARGETS[alias.target_type]
    if needs_region and alias.region not in REGIONS:
        raise ApiError(422, "Choose the Region of the alias target.", "alias")
    return {
        "alias_target_type": alias.target_type,
        "alias_target": dns_name,
        "alias_region": alias.region if needs_region else None,
        "evaluate_target_health": alias.evaluate_target_health,
    }


NO_ALIAS = {
    "alias_target_type": None,
    "alias_target": None,
    "alias_region": None,
    "evaluate_target_health": False,
}


@router.get("", response_model=Page[RecordOut])
def list_records(
    zone_id: str,
    db: DbSession = Depends(get_db),
    q: str = "",
    type: str = "",
    routing_policy: str = "",
    alias: Literal["", "yes", "no"] = "",
    sort: Literal["name", "type", "ttl", "routing_policy"] = "name",
    order: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=300),
):
    zone = get_zone_or_404(db, zone_id)
    stmt = select(RecordSet).where(RecordSet.hosted_zone_id == zone_id)
    if q := q.strip().lower():
        like = f"%{q}%"
        stmt = stmt.where(
            RecordSet.name.like(like) | RecordSet.values_json.ilike(like) | RecordSet.alias_target.ilike(like)
        )
    if type:
        stmt = stmt.where(RecordSet.type == type.upper())
    if routing_policy:
        stmt = stmt.where(RecordSet.routing_policy == routing_policy.lower())
    if alias == "yes":
        stmt = stmt.where(RecordSet.alias_target.is_not(None))
    elif alias == "no":
        stmt = stmt.where(RecordSet.alias_target.is_(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    col = getattr(RecordSet, sort)
    # Like the console: zone apex records first when sorting by name.
    apex_first = case((RecordSet.name == zone.name, 0), else_=1)
    keys = [apex_first, col] if sort == "name" else [col]
    if order == "desc":
        keys = [k.desc() for k in keys]
    stmt = stmt.order_by(*keys, RecordSet.name, RecordSet.type, RecordSet.set_identifier)
    items = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=RecordOut, status_code=201)
def create_record(zone_id: str, body: RecordCreate, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(db, zone_id)
    name = _validated(record_fqdn, "name", body.name, zone.name, body.type)
    if body.alias:
        alias_cols, values, ttl = _check_alias(db, zone, name, body.type, body.alias), [], 300
    else:
        alias_cols = NO_ALIAS
        ttl = _validated(validate_ttl, "ttl", body.ttl)
        values = _validated(validate_values, "values", body.type, body.values)
    policy_cols = _check_policy(db, body.routing_policy, body.type, body, values, body.alias)

    check_conflicts(
        db,
        zone_id,
        name,
        body.type,
        body.routing_policy,
        policy_cols["set_identifier"],
        failover=policy_cols["failover"],
        geo_location=policy_cols["geo_location"],
    )

    record = RecordSet(
        hosted_zone_id=zone_id,
        name=name,
        type=body.type,
        ttl=ttl,
        routing_policy=body.routing_policy,
        **policy_cols,
        **alias_cols,
    )
    record.values = values
    db.add(record)
    db.commit()
    return record


@router.get("/{record_id}", response_model=RecordOut)
def get_record(zone_id: str, record_id: int, db: DbSession = Depends(get_db)):
    return _get_record(db, zone_id, record_id)


@router.patch("/{record_id}", response_model=RecordOut)
def update_record(zone_id: str, record_id: int, body: RecordUpdate, db: DbSession = Depends(get_db)):
    record = _get_record(db, zone_id, record_id)
    changed = body.model_fields_set

    if record.is_protected and changed - {"ttl", "values"}:
        raise ApiError(422, "You can change only the TTL and values of the default SOA and NS records.")

    if "alias" in changed:
        if body.alias:
            record.values = []
            for k, v in _check_alias(db, record.zone, record.name, record.type, body.alias).items():
                setattr(record, k, v)
        else:
            for k, v in NO_ALIAS.items():
                setattr(record, k, v)
    if not record.alias_target:
        if body.ttl is not None:
            record.ttl = _validated(validate_ttl, "ttl", body.ttl)
        if body.values is not None:
            record.values = _validated(validate_values, "values", record.type, body.values)
        if not record.values:
            raise ApiError(422, "Enter at least one value.", "values")

    # Re-validate the policy settings with the changes applied; record ID can't change.
    policy_changed = changed & set(ALL_POLICY_FIELDS + ["health_check_id"])
    own = set(POLICY_FIELDS.get(record.routing_policy, [])) | {"health_check_id"}
    for field in policy_changed - own:
        if getattr(body, field) is not None:
            raise ApiError(
                422,
                f"{field.replace('_', ' ').capitalize()} doesn't apply to "
                f"{POLICY_NAMES[record.routing_policy]} records.",
                field,
            )
    if policy_changed or "values" in changed or "alias" in changed:
        current = {f: getattr(record, f) for f in ALL_POLICY_FIELDS + ["health_check_id"]}
        merged = PolicyFields(
            **current | {f: getattr(body, f) for f in policy_changed}, set_identifier=record.set_identifier
        )
        cols = _check_policy(db, record.routing_policy, record.type, merged, record.values, record.alias)
        check_conflicts(
            db,
            record.hosted_zone_id,
            record.name,
            record.type,
            record.routing_policy,
            record.set_identifier,
            failover=cols["failover"] if "failover" in changed else None,
            geo_location=cols["geo_location"] if "geo_location" in changed else None,
            exclude_id=record.id,
        )
        for k, v in cols.items():
            if k != "set_identifier":
                setattr(record, k, v)
    db.commit()
    return record


@router.delete("/{record_id}", status_code=204)
def delete_record(zone_id: str, record_id: int, db: DbSession = Depends(get_db)):
    record = _get_record(db, zone_id, record_id)
    if record.is_protected:
        raise ApiError(
            400,
            f"You can't delete the {record.type} record that Route 53 created for the hosted zone. "
            "You can edit its values instead.",
        )
    db.delete(record)
    db.commit()
