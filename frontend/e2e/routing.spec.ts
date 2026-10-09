import { expect, test } from "@playwright/test";
import { apiCreateRecord, apiCreateZone, recordRow, signIn, uniq } from "./helpers";

test.beforeEach(({ page }) => signIn(page));

test("health check, then a failover record that uses it", async ({ page }) => {
  const name = `web-${uniq()}`;
  await page.goto("/healthchecks/create/");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("textbox", { name: "IP address" }).fill("192.0.2.10");
  await page.getByRole("button", { name: "Create health check" }).click();
  await expect(page.getByText(/was successfully created/)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("192.0.2.10");

  const hc = (await (await page.request.get(`/api/health-checks?q=${name}`)).json()).items[0];
  const zone = await apiCreateZone(page.request, `fo-${uniq()}.com`);
  await apiCreateRecord(page.request, zone.id, {
    name: "app",
    type: "A",
    values: ["192.0.2.1"],
    routing_policy: "failover",
    set_identifier: "primary",
    failover: "PRIMARY",
    health_check_id: hc.id,
  });
  await page.goto(`/hostedzones/details/?id=${zone.id}`);
  await expect(recordRow(page, `app.${zone.name.slice(0, -1)}`, "A")).toContainText("Failover");
});

test("alias record routes to another record in the zone", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `al-${uniq()}.com`);
  const apex = zone.name.slice(0, -1);
  await apiCreateRecord(page.request, zone.id, { name: "origin", type: "A", values: ["192.0.2.5"] });
  await apiCreateRecord(page.request, zone.id, {
    name: "www",
    type: "A",
    alias: { target_type: "record", dns_name: `origin.${apex}`, evaluate_target_health: false },
  });
  await page.goto(`/hostedzones/details/?id=${zone.id}`);
  await expect(recordRow(page, `www.${apex}`, "A")).toContainText(`origin.${apex}`);
});

test("CIDR collection with a location", async ({ page }) => {
  const name = `office-${uniq()}`;
  await page.goto("/cidrcollections/create/");
  await page.getByLabel("Collection name").fill(name);
  await page.getByRole("button", { name: "Add location" }).click();
  await page.getByRole("textbox", { name: "Location 1 name" }).fill("hq");
  await page
    .getByRole("textbox", { name: /CIDR blocks/ })
    .first()
    .fill("192.0.2.0/24\n198.51.100.0/24");
  await page.getByRole("button", { name: "Create CIDR collection" }).click();
  await expect(page.getByText(/was successfully created/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toContainText("hq");
});

test("private zone associated with two VPCs", async ({ page }) => {
  const name = `multi-${uniq()}.internal`;
  await page.goto("/hostedzones/create/");
  await page.getByLabel("Domain name").fill(name);
  await page.getByText("Private hosted zone", { exact: true }).click();
  await page.getByRole("button", { name: /Choose region/ }).click();
  await page.getByRole("option", { name: /Europe \(Ireland\)/ }).click();
  await page.getByRole("combobox", { name: "VPC ID" }).first().fill("vpc-0a1b2c3d4e5f67890");
  await page.getByRole("button", { name: "Add VPC" }).click();
  await page.getByRole("button", { name: /Choose region/ }).click();
  await page.getByRole("option", { name: /US East \(N. Virginia\)/ }).click();
  await page.getByRole("combobox", { name: "VPC ID" }).nth(1).fill("vpc-0123456789abcdef0");
  await page.getByRole("button", { name: "Create hosted zone" }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("button", { name: "Hosted zone details" }).click();
  await expect(page.getByText("vpc-0a1b2c3d4e5f67890 (eu-west-1)")).toBeVisible();
  await expect(page.getByText("vpc-0123456789abcdef0 (us-east-1)")).toBeVisible();
});
