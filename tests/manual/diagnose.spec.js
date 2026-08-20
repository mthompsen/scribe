// @ts-check
// Diagnostic run against the CURRENT index.html: upload a large non-MP3
// fixture, let conversion fail, and capture the REAL console output —
// serialized error objects with stacks, page errors, worker lifecycle,
// and failed network requests. This is the evidence-gathering step, not
// the pass/fail regression test.
const { test } = require("@playwright/test");
const path = require("path");

const FIXTURE = path.join(__dirname, "..", "fixtures", "fixture.m4a");

/** Serialize a console-message arg on the page side so Error objects give
 *  up their stacks instead of printing as JSHandle@error. */
async function serializeArg(arg) {
  try {
    return await arg.evaluate((v) => {
      if (v instanceof Error) return v.stack || v.name + ": " + v.message;
      if (typeof v === "object" && v !== null) {
        try { return JSON.stringify(v); } catch { return String(v); }
      }
      return String(v);
    });
  } catch {
    return String(arg);
  }
}

test("diagnose: capture real console output at point of conversion failure", async ({ page }) => {
  const events = [];
  const record = (line) => {
    events.push(line);
    console.log(line);
  };

  page.on("console", async (msg) => {
    const parts = await Promise.all(msg.args().map(serializeArg));
    const text = parts.length ? parts.join(" ") : msg.text();
    record(`[console.${msg.type()}] ${text}`);
  });
  page.on("pageerror", (err) => record(`[pageerror] ${err.stack || err}`));
  page.on("requestfailed", (req) =>
    record(`[requestfailed] ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
  page.on("worker", (worker) => {
    record(`[worker created] ${worker.url()}`);
    worker.on("close", () => record(`[worker closed] ${worker.url()}`));
  });
  page.on("response", (res) => {
    if (res.status() >= 400) record(`[http ${res.status()}] ${res.url()}`);
  });

  // Never let a real Groq call happen in the diagnostic run.
  await page.route("https://api.groq.com/**", (route) =>
    route.fulfill({ status: 500, body: '{"error":{"message":"blocked by test"}}' }));

  await page.goto("/index.html");

  // File-picker handler attached?
  const handlerAttached = await page.evaluate(() => {
    const el = document.getElementById("file");
    return !!(el && el.onchange);
  });
  record(`[check] file input onchange attached: ${handlerAttached}`);

  // Dummy key so the click gets past the alert guard (never reaches Groq).
  await page.fill("#key", "gsk_dummy_key_for_diagnostics");
  await page.setInputFiles("#file", FIXTURE);
  await page.click("#go");

  // Wait until the on-page log shows terminal success or failure of conversion.
  await page.waitForFunction(() => {
    const t = document.getElementById("log")?.textContent || "";
    return t.includes("ERROR:") || t.includes("converted:") || t.includes("core loaded");
  }, { timeout: 240_000 });

  // Give trailing async console traffic a moment to flush.
  await page.waitForTimeout(3000);

  const onPageLog = await page.evaluate(() => document.getElementById("log")?.textContent || "");
  console.log("\n===== ON-PAGE LOG =====\n" + onPageLog);
  console.log("\n===== EVENT COUNT =====\n" + events.length + " events captured");
});
