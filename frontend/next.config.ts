import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    trailingSlash: true,
    transpilePackages: ["@cloudscape-design/components", "@cloudscape-design/component-toolkit"],
  };
  // Dev: proxy /api to FastAPI so the session cookie stays same-origin.
  // Prod: static export served by FastAPI itself.
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    // skipTrailingSlashRedirect: otherwise /api/x is redirected to /api/x/ before the proxy.
    return {
      ...base,
      skipTrailingSlashRedirect: true,
      rewrites: async () => [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }],
    };
  }
  return { ...base, output: "export", images: { unoptimized: true } };
}
