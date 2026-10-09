import { expect, test } from "@playwright/test";
import { apiCreateRecord, apiCreateZone, confirmDelete, recordRow, signIn, uniq } from "./helpers";

test.beforeEach(({ page }) => signIn(page));

// Workflow 2: Create hosted zone
test("create a public hosted zone and verify it persisted", async ({ page }) => {
  const name = `create-${uniq()}.com`;
  await page.goto("/hostedzones/");
  await page.getByRole("link", { name: "Create hosted zone" }).first().click();
  await expect(page.getByRole("heading", { name: "Create hosted zone" })).toBeVisible();

  await page.getByLabel("Domain name").fill(name);
  await page.getByPlaceholder("The hosted zone is used for...").fill("Workflow 2");
  await page.getByRole("button", { name: "Create hosted zone" }).click();

  await expect(page.getByText(`${name} was successfully created.`)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Records (2)" })).toBeVisible();
  await expect(recordRow(page, name, "SOA")).toHaveCount(1);
  await expect(recordRow(page, name, "NS")).toHaveCount(1);

  await page.getByRole("button", { name: "Hosted zone details" }).click();
  await expect(page.getByText("Workflow 2")).toBeVisible();
  await expect(page.getByText(/awsdns-\d+\.co\.uk\./).first()).toBeVisible();

  // Persisted in SQLite: visible from a fresh API request and after reload.
  const id = new URL(page.url()).searchParams.get("id")!;
  const stored = await (await page.request.get(`/api/hosted-zones/${id}`)).json();
  expect(stored).toMatchObject({
    name: `${name}.`,
    zone_type: "public",
    description: "Workflow 2",
    record_count: 2,
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("create a private hosted zone with a VPC", async ({ page }) => {
  const name = `private-${uniq()}.internal`;
  await page.goto("/hostedzones/create/");
  await page.getByLabel("Domain name").fill(name);
  await page.getByText("Private hosted zone", { exact: true }).click();
  await page.getByRole("button", { name: "Create hosted zone" }).click();
  await expect(page.getByText("Choose a Region.")).toBeVisible();
  await expect(page.getByText("Choose a VPC.")).toBeVisible();

  await page.getByRole("button", { name: /Choose region/ }).click();
  await page.getByRole("option", { name: /Europe \(Ireland\)/ }).click();
  // VPC ID takes any well-formed ID; suggestions are offered for the chosen Region.
  await page.getByRole("combobox", { name: "VPC ID" }).fill("vpc-0a1b2c3d4e5f67890");
  await page.getByRole("button", { name: "Create hosted zone" }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("button", { name: "Hosted zone details" }).click();
  await expect(page.getByText("Private hosted zone")).toBeVisible();
  await expect(page.getByText("vpc-0a1b2c3d4e5f67890 (eu-west-1)")).toBeVisible();
});

test("validation: invalid domain, top-level domain and duplicate zone", async ({ page }) => {
  const name = `dup-${uniq()}.com`;
  await apiCreateZone(page.request, name);
  await page.goto("/hostedzones/create/");
  const domain = page.getByLabel("Domain name");
  const submit = page.getByRole("button", { name: "Create hosted zone" });

  await submit.click();
  await expect(page.getByText("Enter a domain name.")).toBeVisible();
  await domain.fill("com");
  await expect(page.getByText(/doesn't support top-level domains/)).toBeVisible();
  await domain.fill("-bad-.com");
  await expect(page.getByText(/"-bad-" isn't a valid label/)).toBeVisible();

  await domain.fill(name.toUpperCase());
  await submit.click();
  await expect(page.getByText(`A hosted zone named ${name} already exists.`)).toBeVisible();
  await expect(page).toHaveURL(/\/hostedzones\/create\//);
});

// Workflow 3: Manage hosted zones
test("list, search, sort, paginate, open, edit and delete hosted zones", async ({ page }) => {
  const tag = uniq();
  const names = Array.from({ length: 12 }, (_, i) => `m${tag}-${String(i).padStart(2, "0")}.com`);
  for (const n of names) await apiCreateZone(page.request, n);
  const busy = await apiCreateZone(page.request, `m${tag}-zz.com`, { description: "has records" });
  await apiCreateRecord(page.request, busy.id, { name: "www", type: "A", values: ["192.0.2.1"] });

  // 1. List, 2. search
  await page.goto("/hostedzones/");
  await expect(page.getByRole("heading", { name: /Hosted zones/ })).toBeVisible();
  await page.getByPlaceholder("Filter records by property or value").fill(`m${tag}`);
  await expect(page).toHaveURL(new RegExp(`q=m${tag}`));
  await expect(page.getByText("13 matches").first()).toBeVisible();
  const zoneLinks = page.getByRole("table").getByRole("link");
  await expect(zoneLinks).toHaveCount(10);
  await expect(zoneLinks.first()).toHaveText(names[0]);

  // 3. Paginate and sort
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(zoneLinks).toHaveCount(3);
  await page.getByRole("button", { name: "Previous page" }).click();
  await page.getByRole("button", { name: "Record count" }).click();
  await page.getByRole("button", { name: "Record count" }).click();
  await expect(page).toHaveURL(/sort=record_count&order=desc/);
  await expect(zoneLinks.first()).toHaveText(`m${tag}-zz.com`);
  await expect(page.getByRole("row").nth(1)).toContainText("has records");

  // State survives a refresh and back/forward.
  await page.reload();
  await expect(zoneLinks.first()).toHaveText(`m${tag}-zz.com`);

  // 4. Open zone details
  await zoneLinks.first().click();
  await expect(page.getByRole("heading", { level: 1, name: `m${tag}-zz.com` })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/sort=record_count&order=desc/);
  await expect(zoneLinks.first()).toHaveText(`m${tag}-zz.com`);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: `m${tag}-zz.com` })).toBeVisible();

  // 5. Edit supported metadata (description and tags) on the Edit page
  await page.getByRole("link", { name: "Edit hosted zone" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Edit m${tag}-zz.com` })).toBeVisible();
  await page.getByPlaceholder("The hosted zone is used for...").fill("edited description");
  await page.getByRole("button", { name: "Add tag" }).click();
  await page.getByPlaceholder("Enter key").fill("env");
  await page.getByPlaceholder("Enter value").fill("prod");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`Hosted zone m${tag}-zz.com was updated.`)).toBeVisible();
  await page.getByRole("button", { name: "Hosted zone details" }).click();
  await expect(page.getByText("edited description", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Hosted zone tags (1)" })).toBeVisible();

  // 6. Deleting a zone that still has records is refused, like Route 53.
  await page.getByRole("button", { name: "Delete zone" }).click();
  await confirmDelete(page);
  await expect(page.getByRole("dialog").getByText(/contains 1 record\(s\)/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Delete an empty zone from the list, 7. verify it's gone.
  await page.goto(`/hostedzones/?q=${names[0]}`);
  await page.getByRole("row").filter({ hasText: names[0] }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(names[0]);
  await confirmDelete(page);
  await expect(page.getByText(`Hosted zone ${names[0]} was deleted.`)).toBeVisible();
  await expect(page.getByText("No matches")).toBeVisible();
  const list = await (await page.request.get(`/api/hosted-zones?q=${names[0]}`)).json();
  expect(list.total).toBe(0);
});

test("page size preference changes rows per page", async ({ page }) => {
  await page.goto("/hostedzones/");
  await page.getByRole("button", { name: "Preferences" }).first().click();
  await page.getByLabel("30 items").check();
  await page.getByRole("button", { name: "Confirm" }).click();
  const before = await (await page.request.get("/api/hosted-zones?page_size=30")).json();
  await expect(page.getByRole("table").getByRole("link")).toHaveCount(Math.min(before.total, 30));
  await page.reload(); // stored per browser
  await expect(page.getByRole("table").getByRole("link")).toHaveCount(Math.min(before.total, 30));
});

test("Info opens the help panel", async ({ page }) => {
  await page.goto("/hostedzones/");
  await page.getByRole("button", { name: "Open help panel" }).click();
  await expect(page.getByText(/Route 53 is a DNS web service/)).toBeVisible();
});

test("top bar search finds hosted zones", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Alt+s");
  await page.keyboard.type("example.com");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/hostedzones\/\?q=example\.com/);
  await expect(page.getByRole("link", { name: "example.com", exact: true })).toBeVisible();
});

test("mocked sections show Coming soon inside the console shell", async ({ page }) => {
  for (const [path, title] of [
    ["/", "Route 53 Dashboard"],
    ["/trafficpolicies/", "Traffic policies"],
    ["/domains/", "Registered domains"],
    ["/resolver/", "VPCs"],
    ["/profiles/", "Profiles"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation").getByText("Route 53").first()).toBeVisible();
  }
  await page.getByRole("link", { name: "Go to Hosted zones" }).click();
  await expect(page).toHaveURL(/\/hostedzones\/$/);
});

test("bulk delete hosted zones; non-empty zones are refused", async ({ page }) => {
  const tag = uniq();
  const empty1 = await apiCreateZone(page.request, `bulk-${tag}-a.com`);
  await apiCreateZone(page.request, `bulk-${tag}-b.com`);
  const busy = await apiCreateZone(page.request, `bulk-${tag}-c.com`);
  await apiCreateRecord(page.request, busy.id, { name: "www", type: "A", values: ["192.0.2.1"] });

  await page.goto(`/hostedzones/?q=bulk-${tag}`);
  await expect(page.getByRole("table").getByRole("link")).toHaveCount(3);
  await page.getByRole("checkbox", { name: "Select all hosted zones" }).check();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Delete 3 hosted zones?");
  await confirmDelete(page);

  await expect(
    page.getByRole("dialog").getByText(/bulk-.*-c\.com: The hosted zone .* contains 1 record/),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(/Deleted 2 hosted zones/)).toBeVisible();
  await expect(page.getByRole("table").getByRole("link")).toHaveCount(1);
  expect((await page.request.get(`/api/hosted-zones/${empty1.id}`)).status()).toBe(404);
});

test("keyboard shortcuts: ? lists them, / focuses the filter, c creates", async ({ page }) => {
  await page.goto("/hostedzones/");
  await expect(page.getByRole("link", { name: "example.com", exact: true })).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Filter records by property or value")).toBeFocused();
  await page.keyboard.type("c"); // typing in the filter must not trigger the shortcut
  await expect(page).toHaveURL(/\/hostedzones\/$/);

  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/hostedzones\/create\/$/);
});

test("dark mode from the Settings menu, remembered after reload", async ({ page }) => {
  await page.goto("/hostedzones/");
  await page.locator("#top-nav").getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "Dark" }).click();
  await expect(page.locator("body")).toHaveClass(/awsui-dark-mode/);
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/awsui-dark-mode/);
  await page.locator("#top-nav").getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("menuitemcheckbox", { name: "Light" }).click();
  await expect(page.locator("body")).not.toHaveClass(/awsui-dark-mode/);
});
