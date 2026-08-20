// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  testIgnore: "**/manual/**",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8347",
    browserName: "chromium",
  },
  webServer: {
    command: "python3 -m http.server 8347 --bind 127.0.0.1",
    url: "http://127.0.0.1:8347/index.html",
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
