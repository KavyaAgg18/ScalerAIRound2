import ipaddress
import re
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db
from .errors import ApiError
from .models import CidrCollection, CidrLocation, RecordSet
from .schemas import CidrCollectionIn, CidrCollectionOut, CidrLocationIn

router = APIRouter(
    prefix="/api/cidr-collections", tags=["cidr collections"], dependencies=[Depends(current_user)]
)

NAME = re.compile(r"^[A-Za-z0-9_-]+$")


def _locations(items: list[CidrLocationIn]) -> list[CidrLocation]:
    seen: set[str] = set()
    out = []
    for loc in items:
        name = loc.name.strip()
        if not NAME.match(name) or name in seen:
            raise ApiError(
                422,
                f'Location name "{name}" must be unique and use only letters, numbers, - and _.',
                "locations",
            )
        seen.add(name)
        cidrs = []
        for raw in loc.cidrs:
            try:
                cidrs.append(str(ipaddress.ip_network(raw.strip(), strict=True)))
            except ValueError:
                raise ApiError(
                    422,
                    f'"{raw}" in location {name} isn\'t a valid CIDR block, such as 192.0.2.0/24.',
                    "locations",
                ) from None
        row = CidrLocation(name=name)
        row.cidrs = list(dict.fromkeys(cidrs))
        out.append(row)
    return out


def _get(db: DbSession, collection_id: str) -> CidrCollection:
    c = db.get(CidrCollection, collection_id)
    if not c:
        raise ApiError(404, f"No CIDR collection found with ID {collection_id}.")
    return c


def _check_name(db: DbSession, name: str, exclude: str | None = None) -> str:
    name = name.strip()
    if not NAME.match(name):
        raise ApiError(422, "Collection names can contain only letters, numbers, - and _.", "name")
    clash = db.scalar(
        select(CidrCollection).where(CidrCollection.name == name, CidrCollection.id != (exclude or ""))
    )
    if clash:
        raise ApiError(409, f"A CIDR collection named {name} already exists.", "name")
    return name


@router.get("", response_model=list[CidrCollectionOut])
def list_collections(db: DbSession = Depends(get_db)):
    return db.scalars(select(CidrCollection).order_by(CidrCollection.name)).all()


@router.post("", response_model=CidrCollectionOut, status_code=201)
def create_collection(body: CidrCollectionIn, db: DbSession = Depends(get_db)):
    collection = CidrCollection(id=str(uuid.uuid4()), name=_check_name(db, body.name))
    collection.locations = _locations(body.locations)
    db.add(collection)
    db.commit()
    return collection


@router.get("/{collection_id}", response_model=CidrCollectionOut)
def get_collection(collection_id: str, db: DbSession = Depends(get_db)):
    return _get(db, collection_id)


@router.put("/{collection_id}", response_model=CidrCollectionOut)
def update_collection(collection_id: str, body: CidrCollectionIn, db: DbSession = Depends(get_db)):
    collection = _get(db, collection_id)
    collection.name = _check_name(db, body.name, exclude=collection.id)
    new_locations = _locations(body.locations)
    kept = {loc.name for loc in new_locations} | {"*"}
    in_use = db.scalars(
        select(RecordSet.cidr_location).where(RecordSet.cidr_collection_id == collection.id)
    ).all()
    removed = sorted(set(in_use) - kept)
    if removed:
        raise ApiError(409, f"Location(s) {', '.join(removed)} are used by IP-based records.", "locations")
    collection.locations.clear()
    db.flush()
    collection.locations = new_locations
    db.commit()
    return collection


@router.delete("/{collection_id}", status_code=204)
def delete_collection(collection_id: str, db: DbSession = Depends(get_db)):
    collection = _get(db, collection_id)
    used = db.scalar(select(func.count(RecordSet.id)).where(RecordSet.cidr_collection_id == collection_id))
    if used:
        raise ApiError(409, f"This CIDR collection is used by {used} IP-based record(s).")
    db.delete(collection)
    db.commit()
