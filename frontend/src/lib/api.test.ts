import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, bare } from "./api";

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("builds list query strings and skips empty params", async () => {
    const fetch = mockFetch(200, { items: [], total: 0, page: 1, page_size: 10 });
    await api.listZones({ q: "", sort: "name", order: "desc", page: 2, page_size: 25 });
    expect(fetch.mock.calls[0][0]).toBe("/api/hosted-zones?sort=name&order=desc&page=2&page_size=25");
  });

  it("sends JSON bodies with method and content type", async () => {
    const fetch = mockFetch(201, { id: "Z1" });
    await api.createRecord("Z1", {
      name: "www",
      type: "A",
      ttl: 300,
      values: ["1.1.1.1"],
      routing_policy: "simple",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/hosted-zones/Z1/records");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body).values).toEqual(["1.1.1.1"]);
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch(204);
    await expect(api.deleteZone("Z1")).resolves.toBeUndefined();
  });

  it("maps error bodies to ApiError with field errors", async () => {
    mockFetch(409, { detail: "exists", errors: [{ field: "name", message: "exists" }] });
    const err = await api.createZone({ name: "a.com", description: "", zone_type: "public" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("exists");
    expect(err.fieldErrors).toEqual({ name: "exists" });
  });

  it("turns network failures into status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.getZone("Z1").catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toContain("Unable to reach the server");
  });

  it("redirects to sign-in on 401 for data endpoints, not for auth endpoints", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/hostedzones/", search: "?q=x", assign });
    mockFetch(401, { detail: "expired" });
    await api.listZones({}).catch(() => {});
    expect(assign).toHaveBeenCalledWith(`/login/?expired=1&next=${encodeURIComponent("/hostedzones/?q=x")}`);

    assign.mockClear();
    mockFetch(401, { detail: "bad" });
    await api.me().catch(() => {});
    expect(assign).not.toHaveBeenCalled();
  });

  it("bare strips the trailing dot", () => {
    expect(bare("example.com.")).toBe("example.com");
    expect(bare("example.com")).toBe("example.com");
  });
});
