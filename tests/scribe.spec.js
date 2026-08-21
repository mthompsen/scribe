// @ts-check
// End-to-end suite for Scribe, run against real Chromium over http.
// The Groq API is stubbed at the network layer — no key, no external calls.
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const FIX = (n) => path.join(__dirname, "..", "fixtures", n);

const FAKE_VERBOSE_JSON = {
  text: "Hello from the stub.",
  segments: [
    { start: 0, end: 4, text: " Hello from the stub." },
    { start: 4, end: 9, text: " This transcript is fake but well-formed." },
  ],
};

/** Wire up error capture + Groq stub. Returns collectors. */
async function instrument(page) {
  const errors = [];
  const groqRequests = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.stack || err}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon"))
      errors.push(`[console.error] ${msg.text()}`);
  });
  await page.route("**/favicon.ico", (r) => r.fulfill({ status: 204, body: "" }));
  await page.route("https://api.groq.com/openai/v1/audio/transcriptions", (route) => {
    const buf = route.request().postDataBuffer();
    groqRequests.push({ bodyBytes: buf ? buf.length : -1 });
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_VERBOSE_JSON),
    });
  });
  return { errors, groqRequests };
}

async function start(page, fixture) {
  await page.goto("/index.html");
  await page.fill("#key", "gsk_stubbed_key_never_sent_anywhere_real");
  await page.setInputFiles("#file", FIX(fixture));
  await page.click("#go");
}

const logText = (page) =>
  page.evaluate(() => document.getElementById("log")?.textContent || "");

test.describe("page load", () => {
  test("no console errors, handler attached, version stamped", async ({ page }) => {
    const { errors } = await instrument(page);
    await page.goto("/index.html");
    expect(await page.evaluate(() => !!document.getElementById("file").onchange)).toBe(true);
    await expect(page.locator("#ver")).toHaveText(/^v\d+\.\d+\.\d+/);
    expect(errors).toEqual([]);
  });
});

test.describe("container detection (§1 regression)", () => {
  test("magic bytes win over extension", async ({ page }) => {
    await page.goto("/index.html");
    const r = await page.evaluate(async () => {
      const sniff = (bytes) => sniffFormat(new Blob([new Uint8Array(bytes)]));
      const pad = (a) => a.concat(Array(16 - a.length).fill(0));
      const s = (str) => str.split("").map((c) => c.charCodeAt(0));
      return {
        id3: (await sniff(pad(s("ID3").concat([4, 0, 0, 0, 0, 0, 10])))).fmt,
        frame: (await sniff(pad([0xff, 0xfb, 0x90, 0x00]))).fmt,
        wav: (await sniff(s("RIFF").concat([0, 0, 0, 0]).concat(s("WAVEfmt ")))).fmt,
        m4a: (await sniff([0, 0, 0, 32].concat(s("ftypM4A ")).concat([0, 0, 0, 0]))).fmt,
        mp4: (await sniff([0, 0, 0, 32].concat(s("ftypisom")).concat([0, 0, 0, 0]))).fmt,
        ogg: (await sniff(pad(s("OggS")))).fmt,
        flac: (await sniff(pad(s("fLaC")))).fmt,
        junk: (await sniff(pad(s("nope")))).fmt,
      };
    });
    expect(r).toEqual({
      id3: "mp3", frame: "mp3", wav: "wav", m4a: "m4a",
      mp4: "mp4/aac", ogg: "ogg", flac: "flac", junk: "unknown",
    });
  });
});

test.describe("small file (§1 regression)", () => {
  test("under the limit goes up as a single request", async ({ page }) => {
    const { errors, groqRequests } = await instrument(page);
    await start(page, "fixture-small.mp3");
    await expect(page.locator("#log")).toContainText("Done.", { timeout: 60_000 });
    expect(await logText(page)).toContain("sending as one request");
    expect(groqRequests.length).toBe(1);
    await expect(page.locator("#out")).toContainText("Hello from the stub.");
    expect(errors).toEqual([]);
  });
});

test.describe("large MP3 (§1 regression)", () => {
  test("streaming splitter chunks on frame boundaries, no conversion", async ({ page }) => {
    const { errors, groqRequests } = await instrument(page);
    await start(page, "fixture-large.mp3");
    await expect(page.locator("#log")).toContainText("Done.", { timeout: 120_000 });
    const log = await logText(page);
    expect(log).toContain("Scanning for frame boundaries");
    expect(log).toMatch(/\d+ chunks/);
    expect(log).not.toContain("converting");
    expect(groqRequests.length).toBeGreaterThan(1);
    // every chunk under Groq's 25 MB cap
    for (const r of groqRequests) expect(r.bodyBytes).toBeLessThan(25 * 1024 * 1024);
    // timestamped view carries per-chunk offsets
    await page.click('.tab[data-view="ts"]');
    await expect(page.locator("#out")).toContainText("[00:00:00]");
    expect(errors).toEqual([]);
  });
});

test.describe("the bug: large non-MP3 file (§2)", () => {
  test("MP4/AAC named .mp3 is detected, converted in-browser, transcribed", async ({ page }) => {
    test.setTimeout(600_000);
    // The exact motivating case: phone recorder writes AAC into a ".mp3" name.
    const lyingName = FIX("fixture-lying.mp3");
    if (!fs.existsSync(lyingName)) fs.copyFileSync(FIX("fixture.m4a"), lyingName);
    const inputSize = fs.statSync(lyingName).size;

    const { errors, groqRequests } = await instrument(page);
    await start(page, "fixture-lying.mp3");

    // detection must key off magic bytes, not the extension
    await expect(page.locator("#log")).toContainText("detected container: m4a");
    await expect(page.locator("#log")).toContainText("converting to MP3 first");
    await expect(page.locator("#log")).toContainText("converter ready", { timeout: 120_000 });
    await expect(page.locator("#log")).toContainText("converted:", { timeout: 480_000 });
    await expect(page.locator("#log")).toContainText("Done.", { timeout: 60_000 });

    const log = await logText(page);
    const m = log.match(/converted: ([\d.]+) MB -> ([\d.]+) MB/);
    expect(m, "converted size line present").toBeTruthy();
    expect(parseFloat(m[2])).toBeLessThan(parseFloat(m[1]));

    // what actually went to Groq is smaller than the input file
    expect(groqRequests.length).toBeGreaterThan(0);
    for (const r of groqRequests) expect(r.bodyBytes).toBeLessThan(inputSize);

    await expect(page.locator("#out")).toContainText("Hello from the stub.");
    expect(errors).toEqual([]);
  });
});

test.describe("definition of done: huge non-MP3 file (§7.1)", () => {
  test("130 MB MP4/AAC named .mp3 converts, splits the converted MP3, transcribes", async ({ page }) => {
    test.setTimeout(600_000);
    const inputSize = fs.statSync(FIX("fixture-xl.mp3")).size;
    const warnings = [];
    page.on("console", (msg) => { if (msg.type() === "warning") warnings.push(msg.text()); });

    const { errors, groqRequests } = await instrument(page);
    await start(page, "fixture-xl.mp3");

    await expect(page.locator("#log")).toContainText("detected container: mp4/aac");
    await expect(page.locator("#log")).toContainText("converting to MP3 first");
    await expect(page.locator("#log")).toContainText("converted:", { timeout: 480_000 });
    // 90 min at 32 kbps lands over the 18 MB chunk limit → splitter must kick in
    await expect(page.locator("#log")).toContainText("splitting the converted MP3");
    await expect(page.locator("#log")).toContainText("Done.", { timeout: 120_000 });

    expect(groqRequests.length).toBeGreaterThan(1);
    for (const r of groqRequests) expect(r.bodyBytes).toBeLessThan(25 * 1024 * 1024);
    // the WORKERFS mount must not have silently fallen back to a full copy
    expect(warnings.filter((w) => w.includes("WORKERFS mount failed"))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("organized save + library + zip export", () => {
  test("archives class-sorted transcripts, displays them, exports a .zip", async ({ page }) => {
    const { execSync } = require("child_process");
    const { errors } = await instrument(page);

    // First analysis call matches an enrolled course; second matches none.
    const labels = [
      { course: "TH 3301", courseTitle: "Systematic Theology", subject: "Theology",
        date: "2026-03-14", title: "Grace and Free Will" },
      { course: null, courseTitle: null, subject: "History",
        date: "2026-02-02", title: "The Fall of Rome" },
    ];
    let call = 0;
    await page.route("https://api.groq.com/openai/v1/chat/completions", (route) => {
      const body = JSON.parse(route.request().postData());
      const sys = body.messages[0].content;
      let content;
      if (sys.includes("label transcripts")) {
        expect(sys).toContain("TH 3301 — Systematic Theology"); // roster reaches the classifier
        content = JSON.stringify(labels[Math.min(call++, 1)]);
      } else if (sys.includes("readability")) {
        content = "== Introduction ==\n\nCleaned for clarity: " + body.messages[1].content;
      } else {
        content = "- Key point one\n- Key point two";
      }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { content } }] }),
      });
    });

    await start(page, "fixture-small.mp3");
    await expect(page.locator("#log")).toContainText("Done.", { timeout: 60_000 });

    // course roster for automatic filing (inside a collapsed <details>)
    await page.click("summary:has-text('My courses')");
    await page.fill("#courses", "TH 3301 — Systematic Theology\nPL 2310 — Ethics");

    // readability pass rewrites the clean view
    await page.click("#enhance");
    await expect(page.locator("#enhance")).toHaveText("Enhanced ✓");
    await expect(page.locator("#out")).toContainText("Cleaned for clarity:");
    await expect(page.locator("#out")).toContainText("Hello from the stub.");

    // save twice → one course group, one subject-fallback group
    await page.click("#dlOrg");
    await expect(page.locator("#dlOrg")).toHaveText("Save organized");
    await page.click("#dlOrg");
    await expect(page.locator("#library")).toBeVisible();
    await expect(page.locator(".libGroup")).toHaveText(
      ["History", "TH 3301 — Systematic Theology"]); // sorted
    await expect(page.locator(".libItem")).toHaveCount(2);

    // archive survives a reload (IndexedDB)
    await page.reload();
    await expect(page.locator("#library")).toBeVisible();
    await expect(page.locator(".libItem")).toHaveCount(2);

    // click-to-view an archived transcript
    await page.locator(".libItem .name", { hasText: "Grace and Free Will" }).click();
    await expect(page.locator("#out")).toContainText("Hello from the stub.");

    // per-item pretty-printed HTML download: heading + key points rendered
    const [itemDl] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".libItem", { hasText: "The Fall of Rome" }).locator("button", { hasText: "HTML" }).click(),
    ]);
    expect(itemDl.suggestedFilename()).toBe("2026-02-02 — The Fall of Rome.html");
    const html = fs.readFileSync(await itemDl.path(), "utf8");
    expect(html).toContain("The Fall of Rome");
    expect(html).toContain("History");
    expect(html).toContain("Hello from the stub.");
    expect(html).toContain("<h2>Introduction</h2>");
    expect(html).toContain("Key point one");

    // whole-archive zip export, validated with real unzip
    const [zipDl] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#zipAll"),
    ]);
    expect(zipDl.suggestedFilename()).toMatch(/^Transcriptions \d{4}-\d{2}-\d{2}\.zip$/);
    const zipPath = await zipDl.path();
    const listing = execSync(`unzip -l "${zipPath}"`, { encoding: "utf8" });
    expect(listing).toContain("Transcriptions/TH 3301 — Systematic Theology/2026-03-14 — Grace and Free Will.html");
    expect(listing).toContain("Transcriptions/History/2026-02-02 — The Fall of Rome.html");
    execSync(`unzip -t "${zipPath}"`); // CRC check — throws on a corrupt archive

    expect(errors).toEqual([]);
  });
});
