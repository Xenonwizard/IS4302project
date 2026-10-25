import { defineConfig } from "@playwright/test";

// Smoke tests: click through each role's main flow against the real dev server and the local
// blockchain, at desktop size. Run with `npm run test:smoke`.
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/smoke",
  workers: 1, // the tests share one chain, so run them one at a time
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  // PLAYWRIGHT_CHANNEL=chrome uses the installed Google Chrome, so nothing extra has to be downloaded.
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } }],
  // Starts whatever isn't already running: the local chain (with its reset snapshot) and the app.
  webServer: [
    { command: "npm run chain", port: 8545, reuseExistingServer: true, timeout: 180_000 },
    { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
  ],
});
