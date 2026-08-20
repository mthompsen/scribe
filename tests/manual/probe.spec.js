// @ts-check
// Hypothesis probe: the ffmpeg wrapper spawns a MODULE worker when
// classWorkerURL is given, where importScripts() always throws, and the
// fallback `(await import(coreURL)).default` is undefined for the UMD core
// but defined for the ESM core. Verify all three claims in a real browser.
const { test, expect } = require("@playwright/test");

test("probe: module worker importScripts + UMD vs ESM core default export", async ({ page }) => {
  await page.goto("/index.html");

  const result = await page.evaluate(async () => {
    const out = {};

    const runWorker = (code) => new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      const w = new Worker(url, { type: "module" });
      const t = setTimeout(() => { w.terminate(); resolve({ timeout: true }); }, 60000);
      w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(t); w.terminate(); resolve({ workerError: e.message }); };
    });

    // 1. importScripts inside a module worker
    out.importScriptsInModuleWorker = await runWorker(`
      try {
        importScripts("https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js");
        postMessage({ ok: true });
      } catch (e) { postMessage({ threw: e.name + ": " + e.message }); }
    `);

    // 2. dynamic import of the UMD core from a blob module worker
    out.umdCoreDynamicImport = await runWorker(`
      try {
        const m = await import("https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js");
        postMessage({ defaultType: typeof m.default, globalAfter: typeof self.createFFmpegCore });
      } catch (e) { postMessage({ threw: e.name + ": " + e.message }); }
    `);

    // 3. dynamic import of the ESM core
    out.esmCoreDynamicImport = await runWorker(`
      try {
        const m = await import("https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js");
        postMessage({ defaultType: typeof m.default });
      } catch (e) { postMessage({ threw: e.name + ": " + e.message }); }
    `);

    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  expect(result.importScriptsInModuleWorker.threw).toBeTruthy();
  expect(result.umdCoreDynamicImport.defaultType).toBe("undefined");
  expect(result.esmCoreDynamicImport.defaultType).toBe("function");
});
