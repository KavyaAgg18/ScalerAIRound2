import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Fresh SQLite file per run; the FastAPI server serves both the API and the static export (run `npm run build` first).
// Config is re-evaluated in worker processes; keep the first value via the inherited env.
const DB = (process.env.E2E_DB ??= path.join(os.tmpdir(), `r53-e2e-${Date.now()}.db`).replaceAll("\\", "/"));
const PORT = 8010;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `uv run --directory ../backend uvicorn app.main:app --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { DATABASE_URL: `sqlite:///${DB}`, STATIC_DIR: path.resolve("out") },
  },
});
