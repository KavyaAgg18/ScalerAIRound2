import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

// Workflow 1: Authentication
test("sign in, reload keeps the session, sign out protects routes", async ({ page }) => {
  // 1. Visit the application (unauthenticated) -> sign-in page with a return path.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\/\?next=%2F/);

  // Wrong password -> error, still on sign-in.
  await page.getByLabel("Username").fill(DEMO.username);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect user name or password.", { exact: true })).toBeVisible();

  // 2-3. Sign in -> Route 53 dashboard.
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Route 53 Dashboard" })).toBeVisible();
  const cookie = (await page.context().cookies()).find((c) => c.name === "r53_session")!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");

  // 4-5. Refresh -> still signed in.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Route 53 Dashboard" })).toBeVisible();
  await expect(page.locator("#top-nav")).toContainText("developer @ Demo Organization");

  // 6. Sign out from the account menu.
  await page
    .locator("#top-nav")
    .getByRole("button", { name: /Demo Organization|Account menu/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login\//);

  // 7. Protected routes and the API now require authentication.
  for (const path of [
    "/",
    "/hostedzones/",
    "/hostedzones/create/",
    "/hostedzones/details/?id=Z1",
    "/healthchecks/",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\/\?next=/);
  }
  expect((await page.request.get("/api/hosted-zones")).status()).toBe(401);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
});

test("after sign-in the user returns to the page they asked for", async ({ page }) => {
  await page.goto("/hostedzones/?q=example");
  await expect(page).toHaveURL(/\/login\//);
  await page.getByLabel("Username").fill(DEMO.username);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/hostedzones\/\?q=example$/);
  await expect(page.getByRole("link", { name: "example.com" })).toBeVisible();
});

test("an expired session sends the user to sign-in with a notice, then back", async ({ page, context }) => {
  await signIn(page);
  await page.goto("/hostedzones/");
  await expect(page.getByRole("link", { name: "example.com" })).toBeVisible();

  // Session disappears (expiry/logout elsewhere); the next API call returns 401.
  await context.clearCookies();
  await page.getByRole("button", { name: "Hosted zone name" }).click(); // re-sort triggers a request
  await expect(page).toHaveURL(/\/login\/\?expired=1&next=/);
  await expect(page.getByText(/Your session has expired/)).toBeVisible();

  await page.getByLabel("Username").fill(DEMO.username);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/hostedzones\//);
});

test("required-field validation on the sign-in form", async ({ page }) => {
  await page.goto("/login/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your username.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
});
