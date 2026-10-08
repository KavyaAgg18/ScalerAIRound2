import json
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, utcnow

RECORD_TYPES = ("A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA", "SOA")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256 of cookie token
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User] = relationship()


class HostedZone(Base):
    __tablename__ = "hosted_zones"
    __table_args__ = (CheckConstraint("zone_type IN ('public', 'private')"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)  # lowercase, trailing dot
    zone_type: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(String(256), default="")
    vpc_region: Mapped[str | None] = mapped_column(String(32))
    vpc_id: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    records: Mapped[list["RecordSet"]] = relationship(
        back_populates="zone", cascade="all, delete-orphan", passive_deletes=True
    )
    tags: Mapped[list["ZoneTag"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, order_by="ZoneTag.key"
    )
    vpcs: Mapped[list["ZoneVpc"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, order_by="ZoneVpc.id"
    )


class ZoneVpc(Base):
    # VPCs associated with a private hosted zone. (hosted_zones.vpc_region/vpc_id are the
    # pre-multi-VPC columns; startup migration copies them in here and they're no longer written.)
    __tablename__ = "zone_vpcs"
    __table_args__ = (UniqueConstraint("hosted_zone_id", "vpc_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    hosted_zone_id: Mapped[str] = mapped_column(ForeignKey("hosted_zones.id", ondelete="CASCADE"))
    region: Mapped[str] = mapped_column(String(32))
    vpc_id: Mapped[str] = mapped_column(String(32))


class HealthCheck(Base):
    __tablename__ = "health_checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), default="")
    protocol: Mapped[str] = mapped_column(String(8))  # HTTP, HTTPS or TCP
    ip_address: Mapped[str | None] = mapped_column(String(45))
    domain_name: Mapped[str | None] = mapped_column(String(255))
    port: Mapped[int]
    resource_path: Mapped[str | None] = mapped_column(String(255))
    request_interval: Mapped[int] = mapped_column(default=30)
    failure_threshold: Mapped[int] = mapped_column(default=3)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class CidrCollection(Base):
    __tablename__ = "cidr_collections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    locations: Mapped[list["CidrLocation"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, order_by="CidrLocation.name"
    )


class CidrLocation(Base):
    __tablename__ = "cidr_locations"
    __table_args__ = (UniqueConstraint("collection_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[str] = mapped_column(ForeignKey("cidr_collections.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(16))
    cidrs_json: Mapped[str] = mapped_column(Text, default="[]")

    @property
    def cidrs(self) -> list[str]:
        return json.loads(self.cidrs_json)

    @cidrs.setter
    def cidrs(self, v: list[str]) -> None:
        self.cidrs_json = json.dumps(v)


class ZoneTag(Base):
    __tablename__ = "zone_tags"
    __table_args__ = (UniqueConstraint("hosted_zone_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    hosted_zone_id: Mapped[str] = mapped_column(ForeignKey("hosted_zones.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(128))
    value: Mapped[str] = mapped_column(String(256), default="")


class RecordSet(Base):
    # One row per record set (name + type + set id); values live in a JSON array.
    __tablename__ = "record_sets"
    __table_args__ = (
        CheckConstraint(f"type IN {RECORD_TYPES}"),
        CheckConstraint("ttl >= 0 AND ttl <= 2147483647"),
        Index(
            "uq_record_set",
            "hosted_zone_id",
            "name",
            "type",
            text("coalesce(set_identifier, '')"),
            unique=True,
        ),
        Index("ix_record_zone_name", "hosted_zone_id", "name"),
        Index("ix_record_zone_type", "hosted_zone_id", "type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hosted_zone_id: Mapped[str] = mapped_column(ForeignKey("hosted_zones.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))  # FQDN, lowercase, trailing dot
    type: Mapped[str] = mapped_column(String(8))
    ttl: Mapped[int]
    values_json: Mapped[str] = mapped_column(Text)
    routing_policy: Mapped[str] = mapped_column(String(16), default="simple")
    set_identifier: Mapped[str | None] = mapped_column(String(128))
    weight: Mapped[int | None]
    # Routing-policy specifics; only the column for the record's own policy is set.
    failover: Mapped[str | None] = mapped_column(String(16))  # PRIMARY / SECONDARY
    region: Mapped[str | None] = mapped_column(String(32))  # latency
    geo_location: Mapped[str | None] = mapped_column(
        String(64)
    )  # "*", "continent:EU", "country:US", "country:US/CA"
    geoproximity: Mapped[str | None] = mapped_column(
        String(64)
    )  # "region:us-east-1" or "coordinates:47.6,-122.3"
    bias: Mapped[int | None]
    cidr_collection_id: Mapped[str | None] = mapped_column(String(36))
    cidr_location: Mapped[str | None] = mapped_column(String(16))
    health_check_id: Mapped[str | None] = mapped_column(String(36))
    # Alias records route to a target instead of holding values.
    alias_target_type: Mapped[str | None] = mapped_column(String(32))
    alias_target: Mapped[str | None] = mapped_column(String(255))
    alias_region: Mapped[str | None] = mapped_column(String(32))
    evaluate_target_health: Mapped[bool | None] = mapped_column(default=False)
    is_protected: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    zone: Mapped[HostedZone] = relationship(back_populates="records")

    @property
    def values(self) -> list[str]:
        return json.loads(self.values_json)

    @values.setter
    def values(self, v: list[str]) -> None:
        self.values_json = json.dumps(v)

    @property
    def alias(self) -> dict | None:
        if not self.alias_target:
            return None
        return {
            "target_type": self.alias_target_type,
            "dns_name": self.alias_target,
            "region": self.alias_region,
            "evaluate_target_health": bool(self.evaluate_target_health),
        }
