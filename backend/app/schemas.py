from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, model_validator

UtcDatetime = Annotated[
    datetime, PlainSerializer(lambda d: d.isoformat(timespec="seconds") + "Z", return_type=str)
]

EditableType = Literal["A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA"]


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    username: str
    # Mocked AWS account details shown in the top-bar account menu.
    account_name: str
    account_id: str
    role: str


class Tag(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str = Field(min_length=1, max_length=128)
    value: str = Field("", max_length=256)


class Vpc(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    region: str
    vpc_id: str


class ZoneCreate(BaseModel):
    name: str
    description: str = Field("", max_length=256)
    zone_type: Literal["public", "private"] = "public"
    vpcs: list[Vpc] = Field(default_factory=list, max_length=100)
    # Older clients sent a single VPC; still accepted.
    vpc_region: str | None = None
    vpc_id: str | None = None
    tags: list[Tag] = Field(default_factory=list, max_length=50)


class ZoneUpdate(BaseModel):
    description: str | None = Field(None, max_length=256)
    tags: list[Tag] | None = Field(None, max_length=50)  # replaces all tags when given
    vpcs: list[Vpc] | None = Field(None, max_length=100)  # private zones only; replaces the set


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    zone_type: str
    description: str
    vpc_region: str | None  # first VPC, kept for older clients
    vpc_id: str | None
    vpcs: list[Vpc]
    record_count: int
    name_servers: list[str]
    tags: list[Tag]
    created_at: UtcDatetime
    updated_at: UtcDatetime


RoutingPolicy = Literal[
    "simple", "weighted", "failover", "latency", "geolocation", "geoproximity", "multivalue", "ip"
]


class Alias(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    target_type: Literal[
        "record", "cloudfront", "globalaccelerator", "elb", "apigateway", "s3", "vpce", "beanstalk"
    ]
    dns_name: str = Field(max_length=255)
    region: str | None = None
    evaluate_target_health: bool = False


class PolicyFields(BaseModel):
    """Per-policy settings; which ones are required depends on routing_policy."""

    set_identifier: str | None = Field(None, max_length=128)
    weight: int | None = Field(None, ge=0, le=255)
    failover: Literal["PRIMARY", "SECONDARY"] | None = None
    region: str | None = None
    geo_location: str | None = Field(None, max_length=64)
    geoproximity: str | None = Field(None, max_length=64)
    bias: int | None = Field(None, ge=-99, le=99)
    cidr_collection_id: str | None = None
    cidr_location: str | None = Field(None, max_length=16)
    health_check_id: str | None = None


class RecordCreate(PolicyFields):
    name: str = ""
    type: EditableType
    ttl: int = 300
    values: list[str] = Field(default_factory=list)
    routing_policy: RoutingPolicy = "simple"
    alias: Alias | None = None


class RecordUpdate(PolicyFields):
    # Name, type, routing policy and record ID can't change, as in the console.
    ttl: int | None = None
    values: list[str] | None = None
    alias: Alias | None = None


class RecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hosted_zone_id: str
    name: str
    type: str
    ttl: int | None  # alias records have no TTL of their own
    values: list[str]
    routing_policy: str
    set_identifier: str | None
    weight: int | None
    failover: str | None
    region: str | None
    geo_location: str | None
    geoproximity: str | None
    bias: int | None
    cidr_collection_id: str | None
    cidr_location: str | None
    health_check_id: str | None
    alias: Alias | None
    is_protected: bool
    created_at: UtcDatetime
    updated_at: UtcDatetime

    @model_validator(mode="after")
    def _alias_has_no_ttl(self):
        if self.alias:
            self.ttl = None
        return self


class HealthCheckIn(BaseModel):
    name: str = Field("", max_length=256)
    protocol: Literal["HTTP", "HTTPS", "TCP"] = "HTTP"
    ip_address: str | None = None
    domain_name: str | None = Field(None, max_length=255)
    port: int | None = Field(None, ge=1, le=65535)
    resource_path: str | None = Field(None, max_length=255)
    request_interval: Literal[10, 30] = 30
    failure_threshold: int = Field(3, ge=1, le=10)


class HealthCheckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    protocol: str
    ip_address: str | None
    domain_name: str | None
    port: int
    resource_path: str | None
    request_interval: int
    failure_threshold: int
    endpoint: str
    status: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


class CidrLocationIn(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str = Field(min_length=1, max_length=16)
    cidrs: list[str] = Field(min_length=1, max_length=1000)


class CidrCollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    locations: list[CidrLocationIn] = Field(default_factory=list, max_length=1000)


class CidrCollectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    locations: list[CidrLocationIn]
    created_at: UtcDatetime
