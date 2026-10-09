import type {
  Account,
  CidrCollection,
  CidrLocation,
  HealthCheck,
  HealthCheckInput,
  HostedZone,
  ListParams,
  Page,
  RecordInput,
  RecordSet,
  RecordUpdate,
  Tag,
  Vpc,
  ZoneType,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: Record<string, string> = {},
    // Every message the server sent, e.g. one per bad line of a zone file.
    public messages: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new ApiError(0, "Unable to reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) {
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/login/?expired=1&next=${encodeURIComponent(next)}`);
    }
    const fieldErrors: Record<string, string> = {};
    for (const e of body.errors ?? []) if (e.field && !fieldErrors[e.field]) fieldErrors[e.field] = e.message;
    const messages: string[] = (body.errors ?? []).map((e: { message: string }) => e.message);
    throw new ApiError(res.status, body.detail ?? `Request failed (${res.status})`, fieldErrors, messages);
  }
  return body as T;
}

function qs(params: ListParams): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  login: (username: string, password: string) =>
    request<Account>("/auth/login", json("POST", { username, password })),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<Account>("/auth/me"),

  listZones: (params: ListParams) => request<Page<HostedZone>>(`/hosted-zones${qs(params)}`),
  getZone: (id: string) => request<HostedZone>(`/hosted-zones/${id}`),
  createZone: (body: {
    name: string;
    description: string;
    zone_type: ZoneType;
    vpcs?: Vpc[];
    tags?: Tag[];
  }) => request<HostedZone>("/hosted-zones", json("POST", body)),
  updateZone: (id: string, changes: { description?: string; tags?: Tag[]; vpcs?: Vpc[] }) =>
    request<HostedZone>(`/hosted-zones/${id}`, json("PATCH", changes)),
  deleteZone: (id: string) => request<void>(`/hosted-zones/${id}`, { method: "DELETE" }),

  listRecords: (zoneId: string, params: ListParams) =>
    request<Page<RecordSet>>(`/hosted-zones/${zoneId}/records${qs(params)}`),
  getRecord: (zoneId: string, id: number) => request<RecordSet>(`/hosted-zones/${zoneId}/records/${id}`),
  createRecord: (zoneId: string, body: RecordInput) =>
    request<RecordSet>(`/hosted-zones/${zoneId}/records`, json("POST", body)),
  updateRecord: (zoneId: string, id: number, body: RecordUpdate) =>
    request<RecordSet>(`/hosted-zones/${zoneId}/records/${id}`, json("PATCH", body)),
  importZoneFile: (zoneId: string, zoneFile: string) =>
    request<{ imported: number; skipped: number }>(
      `/hosted-zones/${zoneId}/import`,
      json("POST", { zone_file: zoneFile }),
    ),
  deleteRecord: (zoneId: string, id: number) =>
    request<void>(`/hosted-zones/${zoneId}/records/${id}`, { method: "DELETE" }),

  listHealthChecks: (params: ListParams = {}) => request<Page<HealthCheck>>(`/health-checks${qs(params)}`),
  getHealthCheck: (id: string) => request<HealthCheck>(`/health-checks/${id}`),
  createHealthCheck: (body: HealthCheckInput) => request<HealthCheck>("/health-checks", json("POST", body)),
  updateHealthCheck: (id: string, body: HealthCheckInput) =>
    request<HealthCheck>(`/health-checks/${id}`, json("PUT", body)),
  deleteHealthCheck: (id: string) => request<void>(`/health-checks/${id}`, { method: "DELETE" }),

  listCidrCollections: () => request<CidrCollection[]>("/cidr-collections"),
  getCidrCollection: (id: string) => request<CidrCollection>(`/cidr-collections/${id}`),
  createCidrCollection: (body: { name: string; locations: CidrLocation[] }) =>
    request<CidrCollection>("/cidr-collections", json("POST", body)),
  updateCidrCollection: (id: string, body: { name: string; locations: CidrLocation[] }) =>
    request<CidrCollection>(`/cidr-collections/${id}`, json("PUT", body)),
  deleteCidrCollection: (id: string) => request<void>(`/cidr-collections/${id}`, { method: "DELETE" }),
};

// The server answers with Content-Disposition: attachment, so navigating here downloads the file.
export const exportUrl = (zoneId: string, format: "bind" | "json") =>
  `/api/hosted-zones/${zoneId}/export?format=${format}`;

// The console shows names without the trailing dot.
export const bare = (name: string) => name.replace(/\.$/, "");
