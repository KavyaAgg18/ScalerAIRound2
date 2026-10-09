// Shared mocks for page tests. Use from vi.mock factories:
//   vi.mock("next/navigation", async () => (await import("@/test/mocks")).navigationMock);
import AppLayout from "@cloudscape-design/components/app-layout";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import type { ReactNode } from "react";
import { vi, type Mock } from "vitest";
import type { api as realApi } from "@/lib/api";
import type { HostedZone, Page, RecordSet } from "@/lib/types";

export const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
export const nav = { params: new URLSearchParams(), pathname: "/" };

export function setUrl(pathname: string, query = "") {
  nav.pathname = pathname;
  nav.params = new URLSearchParams(query);
}

export const navigationMock = {
  useRouter: () => router,
  useSearchParams: () => nav.params,
  usePathname: () => nav.pathname,
  notFound: vi.fn(),
};

export const DEMO_ACCOUNT = {
  username: "demo",
  account_name: "Demo Organization",
  account_id: "123456789012",
  role: "developer",
};

export const flash = vi.fn();
export const comingSoon = vi.fn();
const follow = (e: CustomEvent<{ href?: string }>) => {
  e.preventDefault();
  if (e.detail.href) router.push(e.detail.href);
};

export const consoleMock = {
  ROUTE53_CRUMB: { text: "Route 53", href: "/" },
  PAGINATION_LABELS: { nextPageLabel: "Next page", previousPageLabel: "Previous page" },
  useConsole: () => ({ account: DEMO_ACCOUNT, flash, flashes: [], navOpen: true, setNavOpen: () => {} }),
  useFollow: () => follow,
  useComingSoon: () => comingSoon,
  useShortcut: () => {},
  InfoLink: () => <span>Info</span>,
  // Real AppLayout (SplitPanel requires it) without the console navigation.
  Shell: ({ children, splitPanel }: { children: ReactNode; splitPanel?: ReactNode }) => (
    <AppLayout navigationHide toolsHide content={children} splitPanel={splitPanel} splitPanelOpen />
  ),
};

export const apiMock = Object.fromEntries(
  [
    "login",
    "logout",
    "me",
    "listZones",
    "getZone",
    "createZone",
    "updateZone",
    "deleteZone",
    "listRecords",
    "getRecord",
    "createRecord",
    "updateRecord",
    "deleteRecord",
    "importZoneFile",
    "listHealthChecks",
    "getHealthCheck",
    "createHealthCheck",
    "updateHealthCheck",
    "deleteHealthCheck",
    "listCidrCollections",
    "getCidrCollection",
    "createCidrCollection",
    "updateCidrCollection",
    "deleteCidrCollection",
  ].map((k) => [k, vi.fn()]),
) as unknown as Record<keyof typeof realApi, Mock>;

export const apiModuleMock = async (importOriginal: () => Promise<object>) => ({
  ...(await importOriginal()),
  api: apiMock,
});

export function zone(overrides: Partial<HostedZone> = {}): HostedZone {
  return {
    id: "ZTEST000000000000001",
    name: "example.com.",
    zone_type: "public",
    description: "Company website",
    vpc_region: null,
    vpc_id: null,
    vpcs: [],
    record_count: 3,
    name_servers: ["ns-1.awsdns-00.com.", "ns-2.awsdns-00.net."],
    tags: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

let recordId = 100;
export function record(overrides: Partial<RecordSet> = {}): RecordSet {
  return {
    id: recordId++,
    hosted_zone_id: "ZTEST000000000000001",
    name: "www.example.com.",
    type: "A",
    ttl: 300,
    values: ["192.0.2.1"],
    routing_policy: "simple",
    set_identifier: null,
    weight: null,
    failover: null,
    region: null,
    geo_location: null,
    geoproximity: null,
    bias: null,
    cidr_collection_id: null,
    cidr_location: null,
    health_check_id: null,
    alias: null,
    is_protected: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export const page = <T,>(items: T[], total = items.length, pageNo = 1, page_size = 10): Page<T> => ({
  items,
  total,
  page: pageNo,
  page_size,
});

// never resolves, so the component stays in its loading state
export const pending = () => new Promise<never>(() => {});

// Cloudscape keeps closed modals in the DOM, so pick the visible one.
export function openModal() {
  const m = createWrapper(document.body)
    .findAllModals()
    .find((x) => x.isVisible());
  if (!m) throw new Error("No visible modal");
  return m;
}
