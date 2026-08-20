# Scribe — engineering brief

A single-file browser app that transcribes audio via Groq's Whisper API.
Deployed at **https://mthompsen.github.io/scribe/** from `index.html` at the
repo root. No build step, no framework, no bundler. Open the file, it runs.

**Your job:** make automatic audio conversion work in the browser so that a user
can upload *any* audio file of *any* size and get a transcript, with no manual
preprocessing. Right now large non-MP3 files fail.

---

## 1. What already works (do not break these)

| Feature | Status |
|---|---|
| Groq Whisper API call, `verbose_json`, segment timestamps | works |
| API key persisted in localStorage | works |
| Container detection from magic bytes (mp3/wav/m4a/mp4/ogg/flac/webm) | works, verified |
| Streaming MP3 frame-boundary splitter, ~1 MB peak memory | works, verified against a reference implementation |
| Frame-density validation (rejects mislabelled files) | works, verified |
| Rate-limit backoff on HTTP 429 | works |
| Clean + timestamped output views, copy, .txt and .doc download | works |
| Dark responsive UI, mobile-friendly | works |

The splitter and validator have been tested and match a separately verified
reference. **Do not rewrite them without cause.**

## 2. The bug

Files **over 18 MB that are not MP3** cannot be processed. The app tries to
convert them to MP3 with ffmpeg.wasm and the core fails to initialise.

Reproduce with any MP4/AAC file over 18 MB. Note that phone recorder apps
routinely produce MP4/AAC named `.mp3`, which is the exact case that motivated
this — so the fix must key off real container detection, not the extension.

**Current error, identical across every loading strategy tried:**

```
initialising ffmpeg core (downloads ~31 MB on first run)…
  direct CDN failed, trying next…
  jsdelivr failed, trying next…
  blob-hosted failed, trying next…
ERROR: all core load strategies failed.
       Last error: "Error: failed to import ffmpeg-core.js"
```

The worker starts. It fails at `importScripts()` of the core. The same error
appears whether the core URL is a CDN URL or a blob URL, which suggests the
problem is the worker/build combination rather than hosting or CORS.

## 3. What has already been tried and ruled out

Do not repeat these.

1. **`<script src>` from unpkg for the wrapper.** Fails earlier, with
   `Failed to construct 'Worker': Script at 'https://unpkg.com/...814.ffmpeg.js'
   cannot be accessed from origin 'https://mthompsen.github.io'`. Browsers
   refuse cross-origin Worker scripts. **Rehosting the worker as a same-origin
   blob does fix this specific error** and is currently in place — keep that
   part.
2. **Core + wasm as blob URLs.** → `failed to import ffmpeg-core.js`.
3. **Core + wasm direct from unpkg.** Same error. CORS is fine: unpkg returns
   `access-control-allow-origin: *` and `content-type: text/javascript`.
4. **Core + wasm from jsdelivr.** Same error.
5. **Version skew.** Wrapper was 0.12.10 with core 0.12.6; now both 0.12.10.
   Did not fix it.

All asset URLs return HTTP 200 and correct sizes (core js ~109 KB,
wasm ~31 MB). Downloading is not the problem.

## 4. Approaches worth trying, roughly in order

Your judgement, but this is the reasoning so far:

**(a) Vendor ffmpeg into the repo.** Commit `ffmpeg.js`, `814.ffmpeg.js`,
`ffmpeg-core.js`, and `ffmpeg-core.wasm` under `vendor/` so everything is
genuinely same-origin with no CDN, no blob URLs, no cross-origin anything.
~31 MB in the repo; GitHub Pages serves it fine. Highest odds, least clever.

**(b) The ESM build with `<script type="module">`.** The UMD build may simply be
the wrong artifact for this loading pattern. `@ffmpeg/ffmpeg` ships ESM under
`dist/esm/`. This changes how the worker is constructed.

**(c) `@ffmpeg/ffmpeg` 0.11.x.** Older API (`createFFmpeg`), different and
simpler worker model, well documented against static hosting. A downgrade, but
it is known to work in this configuration.

**(d) Drop ffmpeg entirely: Web Audio + lamejs.** `decodeAudioData` handles
MP4/AAC natively in Chrome, then encode MP3 with lamejs (~50 KB, no wasm).
**Memory is the constraint** — a 2-hour file decoded to PCM is hundreds of MB.
If you take this route, decode in segments and encode incrementally; do not
hold the whole PCM buffer. Test with a 2-hour file, not a 2-minute one.

**(e) Sidestep conversion.** Groq accepts MP4/AAC natively, so the only real
problem is the 25 MB request limit. Parsing the MP4 container to split on
sample boundaries would avoid transcoding altogether. More work, but it is the
approach with the best memory profile.

## 5. Required: test in a real browser before deploying

This is the reason the bug survived five attempts. Every previous fix was
reasoned about statically and shipped without execution. **Do not do that.**

Set up Playwright and drive the actual page:

```bash
npm init -y && npm i -D @playwright/test && npx playwright install chromium
```

The test must, at minimum:

- serve the directory over http (`npx serve` or `python3 -m http.server`) —
  **not** `file://`, which has different origin semantics
- load the page, assert no console errors and that the file-picker handler is
  attached
- upload a real MP4/AAC fixture over 18 MB via `setInputFiles`
- capture **all** console messages, page errors, and failed network requests
- assert conversion completes and produces an MP3 smaller than the input

Generate the fixture rather than committing 80 MB:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=1800" -c:a aac -b:a 192k fixture.m4a
```

A 30-minute sine at 192 kbps lands around 40 MB — over the limit, fast to make,
and it exercises the real path. Keep it out of git.

**Report the actual console output when something fails.** The on-page log is a
summary; the console has the stack.

## 6. Constraints

- **Single file.** `index.html` stays self-contained apart from a `vendor/`
  directory if you choose approach (a). No build step, no framework.
- **No API keys in source.** The user's Groq key lives in localStorage. Never
  commit a key, never hardcode one.
- **No telemetry, no analytics, no external calls** beyond the Groq API and
  whatever the converter needs.
- **Mobile must keep working.** Peak memory matters; the streaming splitter
  exists because a phone browser was killing the tab. Do not reintroduce
  whole-file `arrayBuffer()` reads on the main path.
- **Version discipline.** Bump the `VERSION` constant on every change. The
  version chip is how the user confirms a deploy actually landed — several
  debugging cycles were wasted on stale caches.
- **Keep the honest failure path.** If conversion cannot work, the app must
  still say exactly what the file is and what command would fix it, rather than
  failing silently.

## 7. Definition of done

1. A user uploads an 80 MB MP4/AAC file named `.mp3` and gets a transcript,
   with no manual steps.
2. A Playwright test proves it, running against a real Chromium instance.
3. Everything in §1 still works — verified, not assumed.
4. Mobile Chrome handles a large file without the tab being killed.
5. Deployed and confirmed live by reading the version from the served page:
   `curl -s https://mthompsen.github.io/scribe/ | grep -o 'VERSION *= *"[^"]*"'`
