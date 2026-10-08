import ipaddress
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from .auth import current_user
from .db import get_db, utcnow
from .dns_validate import is_hostname
from .errors import ApiError
from .models import HealthCheck, RecordSet
from .schemas import HealthCheckIn, HealthCheckOut, Page

router = APIRouter(prefix="/api/health-checks", tags=["health checks"], dependencies=[Depends(current_user)])

DEFAULT_PORTS = {"HTTP": 80, "HTTPS": 443, "TCP": 80}
# Addresses Route 53 health checkers can't reach (RFC 1918 and IPv6 unique local).
NON_ROUTABLE = [
    ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
]


def _out(hc: HealthCheck) -> HealthCheckOut:
    host = hc.ip_address or hc.domain_name
    if hc.protocol == "TCP":
        endpoint = f"{host}:{hc.port}"
    else:
        endpoint = f"{hc.protocol.lower()}://{host}:{hc.port}{hc.resource_path or '/'}"
    # Simulated: nothing is actually checked. New checks report Unknown until the first
    # "check" would have run, then Healthy.
    age = utcnow() - hc.created_at
    status = "Unknown" if age < timedelta(seconds=hc.request_interval) else "Healthy"
    fields = {f: getattr(hc, f) for f in HealthCheckOut.model_fields if hasattr(hc, f)}
    return HealthCheckOut.model_validate(fields | {"endpoint": endpoint, "status": status})


def _apply(hc: HealthCheck, body: HealthCheckIn) -> None:
    ip = (body.ip_address or "").strip()
    domain = (body.domain_name or "").strip().lower().rstrip(".")
    if bool(ip) == bool(domain):
        raise ApiError(422, "Specify either an IP address or a domain name for the endpoint.", "ip_address")
    if ip:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            raise ApiError(422, f'"{ip}" isn\'t a valid IP address.', "ip_address") from None
        if (
            addr.is_loopback
            or addr.is_link_local
            or any(addr in net for net in NON_ROUTABLE if addr.version == net.version)
        ):
            raise ApiError(422, "Route 53 can only check public IP addresses.", "ip_address")
    if domain and not is_hostname(domain):
        raise ApiError(422, f'"{domain}" isn\'t a valid domain name.', "domain_name")
    path = (body.resource_path or "").strip()
    if body.protocol != "TCP":
        path = path or "/"
        if not path.startswith("/"):
            path = "/" + path
    else:
        path = ""

    hc.name = body.name.strip()
    hc.protocol = body.protocol
    hc.ip_address = ip or None
    hc.domain_name = domain or None
    hc.port = body.port or DEFAULT_PORTS[body.protocol]
    hc.resource_path = path or None
    hc.request_interval = body.request_interval
    hc.failure_threshold = body.failure_threshold


def _get(db: DbSession, check_id: str) -> HealthCheck:
    hc = db.get(HealthCheck, check_id)
    if not hc:
        raise ApiError(404, f"No health check found with ID {check_id}.")
    return hc


@router.get("", response_model=Page[HealthCheckOut])
def list_health_checks(
    db: DbSession = Depends(get_db),
    q: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=300),
):
    stmt = select(HealthCheck)
    if q := q.strip().lower():
        like = f"%{q}%"
        stmt = stmt.where(
            HealthCheck.id.ilike(like)
            | HealthCheck.name.ilike(like)
            | HealthCheck.ip_address.ilike(like)
            | HealthCheck.domain_name.ilike(like)
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(HealthCheck.created_at).offset((page - 1) * page_size).limit(page_size))
    return Page(items=[_out(hc) for hc in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=HealthCheckOut, status_code=201)
def create_health_check(body: HealthCheckIn, db: DbSession = Depends(get_db)):
    hc = HealthCheck(id=str(uuid.uuid4()))
    _apply(hc, body)
    db.add(hc)
    db.commit()
    return _out(hc)


@router.get("/{check_id}", response_model=HealthCheckOut)
def get_health_check(check_id: str, db: DbSession = Depends(get_db)):
    return _out(_get(db, check_id))


@router.put("/{check_id}", response_model=HealthCheckOut)
def update_health_check(check_id: str, body: HealthCheckIn, db: DbSession = Depends(get_db)):
    hc = _get(db, check_id)
    _apply(hc, body)
    db.commit()
    return _out(hc)


@router.delete("/{check_id}", status_code=204)
def delete_health_check(check_id: str, db: DbSession = Depends(get_db)):
    hc = _get(db, check_id)
    used = db.scalar(select(func.count(RecordSet.id)).where(RecordSet.health_check_id == check_id))
    if used:
        raise ApiError(
            409,
            f"This health check is associated with {used} record(s). "
            "Remove it from those records before you delete it.",
        )
    db.delete(hc)
    db.commit()
