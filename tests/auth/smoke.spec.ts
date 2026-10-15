import { test, expect } from "@playwright/test";

// Starter tests so the whole pipeline runs end to end. The auth squad owns this folder: replace the
// generic selectors below with Zedu's real ones (prefer getByRole / getByLabel / data-testid).

test("staging site loads @smoke", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status(), "staging should answer without a server error").toBeLessThan(400);
  await expect(page).toHaveTitle(/\S/);
});

test("user can sign in with the test account @smoke", async ({ page }) => {
  const email = process.env.ZEDU_TEST_EMAIL;
  const password = process.env.ZEDU_TEST_PASSWORD;
  test.skip(!email || !password, "ZEDU_TEST_EMAIL / ZEDU_TEST_PASSWORD not set");

  await page.goto(process.env.ZEDU_LOGIN_PATH || "/login");
  await page.getByLabel(/email/i).fill(email!);
  await page.getByLabel(/password/i).fill(password!);
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();

  // Signed in = we left the login page.
  await expect(page).not.toHaveURL(/login|signin|sign-in/i);
});
