// @ts-check
// One-off Gecko pass: `npx playwright test -c playwright.firefox.config.js`
// Excludes mobile.spec.js (Playwright's mobile emulation is Chromium-only).
const base = require("./playwright.config.js");

module.exports = {
  ...base,
  testIgnore: ["**/manual/**", "**/mobile.spec.js"],
  use: { ...base.use, browserName: "firefox" },
};
