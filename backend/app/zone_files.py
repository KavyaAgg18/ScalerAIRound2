import json
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db
from .dns_validate import record_fqdn, validate_ttl, validate_values
from .errors import ApiError
from .models import RecordSet
from .records import check_conflicts
from .schemas import RecordOut
from .zonefile import parse_zone_file, render_zone_file
from .zones import get_zone_or_404

router = APIRouter(prefix="/api/hosted-zones", tags=["zone files"], dependencies=[Depends(current_user)])


class ZoneFileIn(BaseModel):
    zone_file: str = Field(max_length=1_000_000)


class ImportResult(BaseModel):
    imported: int
    skipped: int


@router.post("/{zone_id}/import", response_model=ImportResult)
def import_zone_file(zone_id: str, body: ZoneFileIn, db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(db, zone_id)
    parsed = parse_zone_file(body.zone_file, zone.name)
    problems = list(parsed.errors)

    # A zone file lists one value per line; Route 53 stores one record set per name + type.
    groups: dict[tuple[str, str], dict] = {}
    for r in parsed.records:
        g = groups.setdefault((r.name, r.type), {"ttl": r.ttl, "values": [], "line": r.line})
        if r.ttl != g["ttl"]:
            problems.append(f"Line {r.line}: all {r.type} records for {r.name} must have the same TTL.")
        g["values"].append(r.value)

    for (name, rtype), g in groups.items():
        try:
            g["name"] = record_fqdn(name, zone.name, rtype)
            validate_ttl(g["ttl"])
            g["values"] = validate_values(rtype, g["values"])
        except ValueError as e:
            problems.append(f"Line {g['line']}: {e}")

    if problems:
        raise ApiError(
            422,
            f"The zone file has {len(problems)} problem(s). Nothing was imported.",
            "zone_file",
            problems,
        )
    if not groups:
        raise ApiError(422, "The zone file doesn't contain any records to import.", "zone_file")

    # All or nothing: any conflict with existing records rolls back the whole import.
    conflicts = []
    for (_, rtype), g in groups.items():
        try:
            check_conflicts(db, zone.id, g["name"], rtype, "simple", None)
        except ApiError as e:
            conflicts.append(f"Line {g['line']}: {e.detail}")
            continue
        record = RecordSet(hosted_zone_id=zone.id, name=g["name"], type=rtype, ttl=g["ttl"])
        record.values = g["values"]
        db.add(record)
        db.flush()
    if conflicts:
        db.rollback()
        raise ApiError(409, "Some records already exist. Nothing was imported.", "zone_file", conflicts)

    db.commit()
    return ImportResult(imported=len(groups), skipped=parsed.skipped)


@router.get("/{zone_id}/export")
def export_zone(zone_id: str, format: Literal["bind", "json"] = "bind", db: DbSession = Depends(get_db)):
    zone = get_zone_or_404(db, zone_id)
    apex_first = case((RecordSet.name == zone.name, 0), else_=1)
    records = db.scalars(
        select(RecordSet)
        .where(RecordSet.hosted_zone_id == zone.id)
        .order_by(apex_first, RecordSet.name, RecordSet.type, RecordSet.set_identifier)
    ).all()
    base = zone.name.rstrip(".")

    if format == "json":
        content = json.dumps(
            {
                "hosted_zone": {
                    "id": zone.id,
                    "name": zone.name,
                    "type": zone.zone_type,
                    "description": zone.description,
                },
                "records": [
                    RecordOut.model_validate(r).model_dump(
                        exclude={"id", "hosted_zone_id", "is_protected", "created_at", "updated_at"},
                        exclude_none=True,
                    )
                    for r in records
                ],
            },
            indent=2,
        )
        media, filename = "application/json", f"{base}.json"
    else:
        content, media, filename = render_zone_file(zone.name, records), "text/plain", f"{base}.zone"

    return Response(
        content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
