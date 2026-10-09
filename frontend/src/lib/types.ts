export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Account {
  username: string;
  account_name: string;
  account_id: string;
  role: string;
}

export type ZoneType = "public" | "private";

export interface Tag {
  key: string;
  value: string;
}

export interface Vpc {
  region: string;
  vpc_id: string;
}

export interface HostedZone {
  id: string;
  name: string;
  zone_type: ZoneType;
  description: string;
  vpc_region: string | null;
  vpc_id: string | null;
  vpcs: Vpc[];
  record_count: number;
  name_servers: string[];
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export const RECORD_TYPES = ["A", "AAAA", "CAA", "CNAME", "MX", "NS", "PTR", "SRV", "TXT"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const ROUTING_POLICIES = [
  "simple",
  "weighted",
  "geolocation",
  "latency",
  "failover",
  "multivalue",
  "ip",
  "geoproximity",
] as const;
export type RoutingPolicy = (typeof ROUTING_POLICIES)[number];

export const POLICY_LABELS: Record<RoutingPolicy, string> = {
  simple: "Simple",
  weighted: "Weighted",
  geolocation: "Geolocation",
  latency: "Latency",
  failover: "Failover",
  multivalue: "Multivalue answer",
  ip: "IP-based",
  geoproximity: "Geoproximity",
};

export type AliasTargetType =
  "record" | "cloudfront" | "globalaccelerator" | "elb" | "apigateway" | "s3" | "vpce" | "beanstalk";

export interface Alias {
  target_type: AliasTargetType;
  dns_name: string;
  region?: string | null;
  evaluate_target_health: boolean;
}

export interface PolicyFields {
  set_identifier?: string | null;
  weight?: number | null;
  failover?: "PRIMARY" | "SECONDARY" | null;
  region?: string | null;
  geo_location?: string | null;
  geoproximity?: string | null;
  bias?: number | null;
  cidr_collection_id?: string | null;
  cidr_location?: string | null;
  health_check_id?: string | null;
}

export interface RecordSet extends Required<PolicyFields> {
  id: number;
  hosted_zone_id: string;
  name: string;
  type: RecordType | "SOA";
  ttl: number | null; // null for alias records
  values: string[];
  routing_policy: RoutingPolicy;
  alias: Alias | null;
  is_protected: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecordInput extends PolicyFields {
  name: string;
  type: RecordType;
  ttl: number;
  values: string[];
  routing_policy: RoutingPolicy;
  alias?: Alias | null;
}

export type RecordUpdate = PolicyFields & { ttl?: number; values?: string[]; alias?: Alias | null };

export interface HealthCheck {
  id: string;
  name: string;
  protocol: "HTTP" | "HTTPS" | "TCP";
  ip_address: string | null;
  domain_name: string | null;
  port: number;
  resource_path: string | null;
  request_interval: 10 | 30;
  failure_threshold: number;
  endpoint: string;
  status: "Healthy" | "Unknown" | "Unhealthy";
  created_at: string;
  updated_at: string;
}

export type HealthCheckInput = Omit<
  HealthCheck,
  "id" | "endpoint" | "status" | "created_at" | "updated_at" | "port"
> & {
  port: number | null;
};

export interface CidrLocation {
  name: string;
  cidrs: string[];
}

export interface CidrCollection {
  id: string;
  name: string;
  locations: CidrLocation[];
  created_at: string;
}

export interface ListParams {
  q?: string;
  type?: string;
  routing_policy?: string;
  alias?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}
