// @ts-check
// Mobile-emulation pass: Pixel 7 viewport/UA/touch. Catches functional
// mobile-only failures (event wiring, layout-triggered JS errors). Cannot
// reproduce device memory kills — that requires a real phone.
const { test, expect, devices } = require("@playwright/test");
const path = require("path");

test.use({ ...devices["Pixel 7"] });

const FIX = (n) => path.join(__dirname, "..", "fixtures", n);

const FAKE = {
  text: "Mobile stub.",
  segments: [{ start: 0, end: 3, text: " Mobile stub." }],
};

async function instrument(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.stack || err}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon"))
      errors.push(`[console.error] ${msg.text()}`);
  });
  page.on("crash", () => errors.push("[PAGE CRASHED]"));
  await page.route("**/favicon.ico", (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("https://api.groq.com/openai/v1/audio/transcriptions", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE) }));
  return errors;
}

test("mobile: pick and transcribe a small file via tap", async ({ page }) => {
  const errors = await instrument(page);
  await page.goto("/index.html");
  await page.fill("#key", "gsk_stub");
  // real tap on the drop zone opens the file chooser on mobile
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.tap("#drop"),
  ]);
  await chooser.setFiles(FIX("fixture-small.mp3"));
  await expect(page.locator("#fileInfo")).toContainText("fixture-small.mp3");
  await page.tap("#go");
  await expect(page.locator("#log")).toContainText("Done.", { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("mobile: large AAC-named-mp3 converts (functional path only)", async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await instrument(page);
  await page.goto("/index.html");
  await page.fill("#key", "gsk_stub");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.tap("#drop"),
  ]);
  await chooser.setFiles(FIX("fixture-lying.mp3"));
  await page.tap("#go");
  await expect(page.locator("#log")).toContainText("converted:", { timeout: 480_000 });
  await expect(page.locator("#log")).toContainText("Done.", { timeout: 60_000 });
  expect(errors).toEqual([]);
});
