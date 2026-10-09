import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const DEMO = { username: "demo", password: "demo1234" };

export const uniq = () => Math.random().toString(36).slice(2, 8);

// page.request shares cookies with the page, so this logs the browser in too.
export async function signIn(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: DEMO });
  expect(res.ok()).toBeTruthy();
}

export async function apiCreateZone(request: APIRequestContext, name: string, extra: object = {}) {
  const res = await request.post("/api/hosted-zones", { data: { name, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

export async function apiCreateRecord(request: APIRequestContext, zoneId: string, data: object) {
  const res = await request.post(`/api/hosted-zones/${zoneId}/records`, { data: { ttl: 300, ...data } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { id: number; name: string };
}

export async function createZoneInUi(page: Page, name: string) {
  await page.goto("/hostedzones/create/");
  await page.getByLabel("Domain name").fill(name);
  await page.getByRole("button", { name: "Create hosted zone" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).searchParams.get("id")!;
}

export function recordRow(page: Page, fqdn: string, type?: string) {
  let rows = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: fqdn, exact: true }) });
  if (type) rows = rows.filter({ has: page.getByRole("cell", { name: type, exact: true }) });
  return rows;
}

export async function confirmDelete(page: Page) {
  const dialog = page.getByRole("dialog");
  const button = dialog.getByRole("button", { name: "Delete" });
  await expect(button).toBeDisabled();
  await dialog.getByPlaceholder("delete").fill("delete");
  await button.click();
}
