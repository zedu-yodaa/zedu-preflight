import { defineConfig, devices } from "@playwright/test";

// Zedu Preflight test settings. Staging only (PRD): the base URL comes from ZEDU_BASE_URL, never hard-coded.
const baseURL = process.env.ZEDU_BASE_URL;
if (!baseURL) {
  throw new Error("ZEDU_BASE_URL is not set. Point it at Zedu staging (GitHub variable, or a local .env).");
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0, // a test that passes on retry is reported as flaky (FR-20)
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // results.json feeds scripts/process-results.mjs; the HTML report is uploaded as evidence.
  reporter: [["list"], ["json", { outputFile: "results.json" }], ["html", { open: "never" }]],

  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
