import { expect, test } from "@playwright/test";
import {
  apiCreateRecord,
  apiCreateZone,
  confirmDelete,
  createZoneInUi,
  recordRow,
  signIn,
  uniq,
} from "./helpers";

test.beforeEach(({ page }) => signIn(page));

// Workflow 4: Create DNS record
test("create an A record with two values; it persists after refresh", async ({ page }) => {
  const zone = `rec-${uniq()}.com`;
  await createZoneInUi(page, zone);

  await page.getByRole("link", { name: "Create record" }).click();
  await expect(page.getByRole("heading", { name: "Quick create record" })).toBeVisible();
  await expect(page.getByText(`.${zone}`)).toBeVisible();
  await page.getByLabel("Record name").fill("www");
  await page.getByLabel("Value").fill("192.0.2.1\n192.0.2.2");
  await page.getByRole("button", { name: "Create records" }).click();

  await expect(page.getByText(`www.${zone} was successfully created.`)).toBeVisible();
  await page.getByRole("button", { name: "View status" }).click();
  await expect(page.getByText(/Status: INSYNC/)).toBeVisible();
  const row = recordRow(page, `www.${zone}`, "A");
  await expect(row).toContainText("192.0.2.1");
  await expect(row).toContainText("192.0.2.2");
  await expect(row).toContainText("300");
  await expect(page.getByRole("tab", { name: "Records (3)" })).toBeVisible();

  await page.reload();
  await expect(row).toContainText("192.0.2.2");
});

test("quick-create several records of different types at once", async ({ page }) => {
  const zone = `multi-${uniq()}.com`;
  const id = await createZoneInUi(page, zone);
  await page.goto(`/hostedzones/records/create/?zoneId=${id}`);
  await page.getByRole("button", { name: "Add another record" }).click();
  await page.getByRole("button", { name: "Add another record" }).click();
  const names = page.getByLabel("Record name");
  const values = page.getByRole("textbox", { name: "Value", exact: true });
  const types = page.getByRole("button", { name: /Record type/ });

  await names.nth(0).fill("mail");
  await values.nth(0).fill("10.0.0.5");

  await types.nth(1).click();
  await page.getByRole("option", { name: /^MX –/ }).click();
  await values.nth(1).fill("10 mail1.example.net\n20 mail2.example.net");

  await types.nth(2).click();
  await page.getByRole("option", { name: /^TXT –/ }).click();
  await values.nth(2).fill('"v=spf1 include:example.net -all"');
  await page.getByRole("button", { name: "1h" }).nth(2).click();

  await page.getByRole("button", { name: "Create records" }).click();
  await expect(page.getByText(/were successfully created/)).toBeVisible();
  await expect(recordRow(page, `mail.${zone}`, "A")).toContainText("10.0.0.5");
  await expect(recordRow(page, zone, "MX")).toContainText("20 mail2.example.net");
  await expect(recordRow(page, zone, "TXT")).toContainText("3,600");
});

test("record validation errors for each kind of bad input", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `val-${uniq()}.com`);
  await apiCreateRecord(page.request, zone.id, { name: "taken", type: "A", values: ["192.0.2.9"] });
  await page.goto(`/hostedzones/records/create/?zoneId=${zone.id}`);
  const submit = page.getByRole("button", { name: "Create records" });
  const value = page.getByLabel("Value");
  const ttl = page.getByLabel("TTL (seconds)");

  await submit.click();
  await expect(page.getByText("Enter at least one value.")).toBeVisible();

  await value.fill("300.1.1.1");
  await expect(
    page.getByText(`"300.1.1.1" isn't a valid IPv4 address, for example 192.0.2.44.`),
  ).toBeVisible();

  await value.fill("192.0.2.1");
  await ttl.fill("abc");
  await expect(page.getByText("Enter a TTL in seconds (a whole number).")).toBeVisible();
  await ttl.fill("2147483648");
  await expect(page.getByText(/TTL must be between 0 and 2147483647/)).toBeVisible();
  await ttl.fill("300");

  await page.getByRole("button", { name: /Record type/ }).click();
  await page.getByRole("option", { name: /^CNAME –/ }).click();
  await value.fill("target.example.net");
  await expect(
    page.getByText("You can't create a CNAME record at the zone apex. Enter a subdomain name."),
  ).toBeVisible();

  await page.getByRole("button", { name: /Record type/ }).click();
  await page.getByRole("option", { name: /^MX –/ }).click();
  await value.fill("mail.example.com");
  await expect(page.getByText(/Use the format \[priority\] \[mail server host name\]/)).toBeVisible();

  // Server-side rule: a record with the same name and type already exists.
  await page.getByRole("button", { name: /Record type/ }).click();
  await page.getByRole("option", { name: /^A –/ }).click();
  await page.getByLabel("Record name").fill("taken");
  await value.fill("192.0.2.10");
  await submit.click();
  await expect(
    page.getByText(`A record named taken.${zone.name.replace(/\.$/, "")} with type A already exists.`, {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/records\/create/);
});

test("weighted records need a record ID and weight, and appear as separate rows", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `wt-${uniq()}.com`);
  for (const [id, weight, ip] of [
    ["blue", "70", "192.0.2.1"],
    ["green", "30", "192.0.2.2"],
  ]) {
    await page.goto(`/hostedzones/records/create/?zoneId=${zone.id}`);
    await page.getByLabel("Record name").fill("app");
    await page.getByLabel("Value").fill(ip);
    await page.getByRole("button", { name: /Routing policy/ }).click();
    await page.getByRole("option", { name: "Weighted" }).click();
    await page.getByRole("button", { name: "Create records" }).click();
    await expect(
      page.getByText("Enter a record ID to differentiate records with the same name and type."),
    ).toBeVisible();
    await page.getByLabel("Weight", { exact: true }).fill(weight);
    await page.getByLabel("Record ID", { exact: true }).fill(id);
    await page.getByRole("button", { name: "Create records" }).click();
    await expect(page.getByText(/was successfully created/)).toBeVisible();
  }
  const rows = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^app./ }) });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "blue" })).toContainText("70");
  await expect(rows.filter({ hasText: "green" })).toContainText("Weighted");
});

// Workflow 5: Edit / delete DNS record
test("select, edit, then delete a record", async ({ page }) => {
  const zone = `edit-${uniq()}.com`;
  const id = await createZoneInUi(page, zone);
  await apiCreateRecord(page.request, id, { name: "api", type: "CNAME", values: ["lb.example.net"] });
  await page.reload();

  // 1. Select -> split panel with details.
  const row = recordRow(page, `api.${zone}`, "CNAME");
  await row.getByRole("checkbox").check();
  await expect(page.getByRole("heading", { name: `api.${zone} (CNAME)` })).toBeVisible();

  // 2-3. Edit supported fields and save.
  await page.getByRole("link", { name: "Edit record" }).click();
  await expect(page.getByRole("heading", { name: "Edit record" })).toBeVisible();
  await expect(page.getByLabel("Record name")).toBeDisabled();
  await page.getByLabel("Value").fill("lb2.example.net");
  await page.getByLabel("TTL (seconds)").fill("3600");
  await page.getByRole("button", { name: "Save" }).click();

  // 4. Updated values are shown and stored.
  await expect(page.getByText(`Record api.${zone} (CNAME) was successfully updated.`)).toBeVisible();
  await expect(row).toContainText("lb2.example.net");
  await expect(row).toContainText("3,600");
  const stored = (await (await page.request.get(`/api/hosted-zones/${id}/records?type=CNAME`)).json())
    .items[0];
  expect(stored).toMatchObject({ ttl: 3600, values: ["lb2.example.net"] });

  // 5-6. Delete with confirmation.
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Delete record" }).click();
  await expect(page.getByRole("dialog")).toContainText(`api.${zone} (CNAME)`);
  await confirmDelete(page);
  await expect(page.getByText(`Deleted record: api.${zone} (CNAME).`)).toBeVisible();

  // 7. Gone from the table and the database.
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Records (2)" })).toBeVisible();
  const after = await (await page.request.get(`/api/hosted-zones/${id}/records?type=CNAME`)).json();
  expect(after.total).toBe(0);
});

test("default SOA and NS records can be edited but not deleted", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `prot-${uniq()}.com`);
  await page.goto(`/hostedzones/details/?id=${zone.id}`);
  const deleteButton = page.getByRole("button", { name: "Delete record" });
  await expect(deleteButton).toBeDisabled();

  await page.getByRole("row").filter({ hasText: "SOA" }).getByRole("checkbox").check();
  await expect(deleteButton).toBeDisabled();
  await page.getByRole("link", { name: "Edit record" }).click();
  await expect(page.getByText(/Route 53 created this SOA record/)).toBeVisible();
  await page.getByLabel("TTL (seconds)").fill("60");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row").filter({ hasText: "SOA" })).toContainText("60");

  // Also enforced by the API, not just the UI.
  const soa = (await (await page.request.get(`/api/hosted-zones/${zone.id}/records?type=SOA`)).json())
    .items[0];
  expect((await page.request.delete(`/api/hosted-zones/${zone.id}/records/${soa.id}`)).status()).toBe(400);
});

test("records table: search, type filter, sorting and pagination on a large zone", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `big-${uniq()}.com`);
  for (let i = 0; i < 60; i++) {
    await apiCreateRecord(page.request, zone.id, {
      name: `host${String(i).padStart(2, "0")}`,
      type: "A",
      values: [`10.0.0.${i}`],
    });
  }
  await apiCreateRecord(page.request, zone.id, { name: "txt", type: "TXT", values: ['"hello"'] });
  await page.goto(`/hostedzones/details/?id=${zone.id}`);
  await expect(page.getByRole("tab", { name: "Records (63)" })).toBeVisible();

  const bodyRows = page
    .getByRole("table")
    .getByRole("row")
    .filter({ has: page.getByRole("checkbox") })
    .filter({ hasNotText: "Record name" });
  await expect(bodyRows).toHaveCount(63); // default page size is 100, as in the console

  // Switch to 30 per page from the table preferences.
  await page.getByRole("button", { name: "Preferences" }).first().click();
  await page.getByLabel("30 items").check();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(bodyRows).toHaveCount(30);
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(bodyRows).toHaveCount(3);
  await expect(page).toHaveURL(/page=3/);

  await page.getByRole("button", { name: /Filter by type/ }).click();
  await page.getByRole("option", { name: "TXT", exact: true }).click();
  await expect(page).toHaveURL(/type=TXT/);
  await expect(bodyRows).toHaveCount(1);
  await expect(bodyRows.first()).toContainText("hello");
  await expect(page.getByText("Type: TXT")).toBeVisible(); // filter chip

  await page.getByRole("button", { name: "Remove filter Type: TXT" }).click();
  await expect(page).not.toHaveURL(/type=/);
  await page.getByPlaceholder("Filter records by property or value").fill("host5");
  await expect(page.getByText("10 matches").first()).toBeVisible();
  await page.getByPlaceholder("Filter records by property or value").fill("10.0.0.42");
  await expect(bodyRows).toHaveCount(1);
  await expect(bodyRows.first()).toContainText(`host42.${zone.name.replace(/\.$/, "")}`);

  await page.getByPlaceholder("Filter records by property or value").fill("");
  await page
    .getByRole("columnheader", { name: /Record name/ })
    .getByRole("button")
    .first()
    .click(); // descending
  await expect(page).toHaveURL(/order=desc/);
  await expect(bodyRows.first()).toContainText("txt.");
});

test("import a BIND zone file, then export it as BIND and JSON", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `imp-${uniq()}.com`);
  const name = zone.name.replace(/\.$/, "");
  await page.goto(`/hostedzones/details/?id=${zone.id}`);
  await page.getByRole("link", { name: "Import zone file" }).click();
  await expect(page.getByRole("heading", { name: "Import zone file" })).toBeVisible();

  // A bad line blocks the whole import and is reported by line number.
  await page.getByLabel("Zone file", { exact: true }).fill("www A 192.0.2.1\nbad A 999.0.0.1\n");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("The zone file has 1 problem(s). Nothing was imported.")).toBeVisible();
  await expect(page.getByText(/Line 2: "999.0.0.1" isn't a valid IPv4 address/)).toBeVisible();

  await page
    .getByLabel("Zone file", { exact: true })
    .fill(
      [
        `$ORIGIN ${name}.`,
        "$TTL 600",
        "@    IN NS ns1.elsewhere.net.",
        "www  IN A  192.0.2.1",
        "www  IN A  192.0.2.2",
        '@       TXT "imported"',
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(`Imported 2 record(s) into ${name}.`, { exact: false })).toBeVisible();
  await expect(recordRow(page, `www.${name}`, "A")).toContainText("192.0.2.2");
  await expect(recordRow(page, `www.${name}`, "A")).toContainText("600");

  const bind = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export zone" }).click();
  await page.getByRole("menuitem", { name: /BIND zone file/ }).click();
  const bindFile = await bind;
  expect(bindFile.suggestedFilename()).toBe(`${name}.zone`);
  const text = (await (await bindFile.createReadStream()).toArray()).join("");
  expect(text).toContain(`www.${name}.\t600\tIN\tA\t192.0.2.1`);

  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export zone" }).click();
  await page.getByRole("menuitem", { name: /JSON/ }).click();
  const jsonFile = await json;
  expect(jsonFile.suggestedFilename()).toBe(`${name}.json`);
  const data = JSON.parse((await (await jsonFile.createReadStream()).toArray()).join(""));
  expect(data.records.map((r: { type: string }) => r.type).sort()).toEqual(["A", "NS", "SOA", "TXT"]);
});

test("create a weighted record with the wizard", async ({ page }) => {
  const zone = await apiCreateZone(page.request, `wiz-${uniq()}.com`);
  const name = zone.name.replace(/\.$/, "");
  await page.goto(`/hostedzones/records/create/?zoneId=${zone.id}`);
  await page.getByText("Switch to wizard").click();

  await page.getByText("Weighted", { exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Record name").fill("api");
  await page.getByLabel("Value").fill("192.0.2.30");
  await page.getByLabel("Weight", { exact: true }).fill("25");
  await page.getByLabel("Record ID", { exact: true }).fill("green");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(`api.${name}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create records" }).click();
  await expect(page.getByText(`api.${name} was successfully created.`)).toBeVisible();
  await expect(recordRow(page, `api.${name}`, "A")).toContainText("Weighted");
  await expect(recordRow(page, `api.${name}`, "A")).toContainText("green");
});
