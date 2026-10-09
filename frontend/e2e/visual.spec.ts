import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Visual regression at three viewports. Baselines live in e2e/visual.spec.ts-snapshots/;
// refresh them on purpose with `npx playwright test visual --update-snapshots`.
// IDs and name servers are random per database, so those cells are masked.

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "small", width: 768, height: 1024 },
];

const masks = (page: Page) => [page.getByText(/^Z[A-Z0-9]{20}$/), page.getByText(/awsdns/)];

async function snap(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: false,
    mask: masks(page),
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("sign-in page", async ({ page }) => {
      await page.goto("/login/");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await snap(page, `${vp.name}-login`);
    });

    test("console pages", async ({ page }) => {
      await signIn(page);
      await page.goto("/hostedzones/?q=example.com");
      await expect(page.getByRole("link", { name: "example.com" })).toBeVisible();
      await snap(page, `${vp.name}-hosted-zones`);

      await page.getByRole("link", { name: "example.com" }).click();
      await expect(page.getByRole("row").filter({ hasText: "www.example.com" })).toBeVisible();
      await snap(page, `${vp.name}-zone-details`);

      await page.getByRole("row").filter({ hasText: "www.example.com" }).getByRole("checkbox").check();
      await expect(page.getByRole("heading", { name: "www.example.com (A)" })).toBeVisible();
      await snap(page, `${vp.name}-record-selected`);

      await page.getByRole("link", { name: "Create record" }).click();
      await expect(page.getByRole("heading", { name: "Quick create record" })).toBeVisible();
      await snap(page, `${vp.name}-create-record`);

      await page.getByText("Switch to wizard").click();
      await expect(page.getByRole("heading", { name: "Choose routing policy" })).toBeVisible();
      await snap(page, `${vp.name}-wizard`);

      await page.goto("/hostedzones/create/");
      await expect(page.getByRole("heading", { name: "Create hosted zone" })).toBeVisible();
      await snap(page, `${vp.name}-create-zone`);

      const zones = await (await page.request.get("/api/hosted-zones?q=example.com")).json();
      await page.goto(`/hostedzones/edit/?id=${zones.items[0].id}`);
      await expect(page.getByRole("heading", { name: "Edit example.com" })).toBeVisible();
      await snap(page, `${vp.name}-edit-zone`);

      await page.goto("/hostedzones/?q=example.com");
      await page.getByRole("checkbox", { name: "example.com" }).check();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Delete hosted zone example.com?");
      await snap(page, `${vp.name}-delete-zone`);

      await page.goto("/domains/");
      await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
      await snap(page, `${vp.name}-coming-soon`);

      await page.goto(`/hostedzones/records/import/?zoneId=${zones.items[0].id}`);
      await expect(page.getByRole("heading", { name: "Import zone file" })).toBeVisible();
      await snap(page, `${vp.name}-import`);
    });
  });
}
