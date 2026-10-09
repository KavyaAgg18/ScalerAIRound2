import { geoLabel } from "./geo";
import type { PolicyFields, RoutingPolicy } from "./types";

type Routed = PolicyFields & { routing_policy: RoutingPolicy };

/** What the console shows in the "Differentiator" column for each routing policy. */
export function differentiator(r: Routed): string {
  switch (r.routing_policy) {
    case "weighted":
      return r.weight == null ? "-" : String(r.weight);
    case "failover":
      return r.failover === "PRIMARY" ? "Primary" : r.failover === "SECONDARY" ? "Secondary" : "-";
    case "latency":
      return r.region ?? "-";
    case "geolocation":
      return geoLabel(r.geo_location ?? null);
    case "geoproximity": {
      const where = r.geoproximity?.replace(/^region:/, "").replace(/^coordinates:/, "") ?? "-";
      return r.bias ? `${where} (bias ${r.bias})` : where;
    }
    case "ip":
      return r.cidr_location ?? "-";
    default:
      return "-";
  }
}
