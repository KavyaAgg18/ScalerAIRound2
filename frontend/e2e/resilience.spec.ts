import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import { DEMO, apiCreateRecord, apiCreateZone, signIn, uniq } from "./helpers";

test.beforeEach(({ page }) => signIn(page));

// Workflow 6: errors and edge cases
test("unknown hosted zone and unknown record show not-found states", async ({ page }) => {
  await page.goto("/hostedzones/details/?id=ZDOESNOTEXIST");
  await expect(page.getByText("Hosted zone not found")).toBeVisible();
  await page.getByRole("link", { name: "Go to Hosted zones" }).click();
  await expect(page).toHaveURL(/\/hostedzones\/$/);

  const zone = await apiCreateZone(page.request, `nf-${uniq()}.com`);
  await page.goto(`/hostedzones/records/edit/?zoneId=${zone.id}&id=999999`);
  await expect(page.getByText("Unable to load record")).toBeVisible();
  await expect(page.getByText(/No record found with ID 999999/)).toBeVisible();
});

test("API unavailable: error message and Retry", async ({ page }) => {
  await page.route("**/api/hosted-zones?*", (route) => route.abort("connectionrefused"));
  await page.goto("/hostedzones/");
  await expect(page.getByText(/Failed to load hosted zones: Unable to reach the server/)).toBeVisible();
  await expect(page.getByText("Unable to load hosted zones")).toBeVisible();

  await page.unroute("**/api/hosted-zones?*");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("link", { name: "example.com" })).toBeVisible();
});

test("empty database shows empty states with a create action", async ({ page }) => {
  // Simulate an empty account without wiping the shared test database.
  await page.route("**/api/hosted-zones?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 10 } }),
  );
  await page.goto("/hostedzones/");
  await expect(page.getByText("No hosted zones", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("There are no hosted zones created for this account.")).toBeVisible();
  await expect(page.getByRole("table").getByRole("link", { name: "Create hosted zone" })).toBeVisible();
});

test("refreshing in the middle of a flow keeps the user's place", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `refresh-${uniq()}.com`);
  await page.goto(`/hostedzones/records/create/?zoneId=${zone.id}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Quick create record" })).toBeVisible();
  await expect(page.getByRole("link", { name: zone.name.replace(/\.$/, "") })).toBeVisible();

  await page.goto(`/hostedzones/details/?id=${zone.id}&type=NS`);
  await page.reload();
  await expect(page.getByText("Type: NS")).toBeVisible();
  await expect(
    page
      .getByRole("table")
      .getByRole("row")
      .filter({ has: page.getByRole("checkbox") }),
  ).toHaveCount(2); // header + NS
});

test("deleting a record that someone else already deleted", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `stale-${uniq()}.com`);
  const rec = await apiCreateRecord(page.request, zone.id, {
    name: "gone",
    type: "A",
    values: ["192.0.2.1"],
  });
  await page.goto(`/hostedzones/details/?id=${zone.id}`);
  await page.getByRole("row").filter({ hasText: "gone." }).getByRole("checkbox").check();

  await page.request.delete(`/api/hosted-zones/${zone.id}/records/${rec.id}`); // deleted elsewhere
  await page.getByRole("button", { name: "Delete record" }).click();
  await page.getByRole("dialog").getByPlaceholder("delete").fill("delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog").getByText(/No record found with ID/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row").filter({ hasText: "gone." })).toHaveCount(0);
});

test("zones and records survive a backend restart", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `persist-${uniq()}.com`);
  await apiCreateRecord(page.request, zone.id, { name: "www", type: "A", values: ["192.0.2.77"] });

  // A second, independent backend process on the same SQLite file = restarted server.
  // Run the venv's Python directly (no shell, no uv wrapper) so kill() really stops it.
  const port = 8100 + Math.floor(Math.random() * 800);
  const python = path.resolve(
    "../backend/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const server = spawn(python, ["-m", "uvicorn", "app.main:app", "--port", String(port)], {
    cwd: path.resolve("../backend"),
    env: { ...process.env, DATABASE_URL: `sqlite:///${process.env.E2E_DB}`, STATIC_DIR: path.resolve("out") },
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    await expect
      .poll(async () => (await page.request.get(`${base}/api/health`).catch(() => null))?.status(), {
        timeout: 30_000,
      })
      .toBe(200);

    // Fresh browser session against the restarted server.
    await page.context().clearCookies();
    await page.goto(`${base}/login/`);
    await page.getByLabel("Username").fill(DEMO.username);
    await page.getByLabel("Password").fill(DEMO.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Route 53 Dashboard" })).toBeVisible();
    await page.goto(`${base}/hostedzones/details/?id=${zone.id}`);
    await expect(page.getByRole("row").filter({ hasText: "192.0.2.77" })).toBeVisible();
  } finally {
    server.kill();
  }
});
