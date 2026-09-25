import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "webkit",
      use: { browserName: "webkit" },
      testMatch: /(?:editor-cursor-heading|render-heading)\.browser\.e2e\.spec\.ts/,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 860, height: 640 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
  workers: 1,
});
