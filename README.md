# Scribe

A single-file browser app that transcribes audio through Groq's Whisper API,
files each transcript under the right course, and cleans it up for reading.

Live at **https://mthompsen.github.io/scribe/**, served from `index.html` at
the repo root. No build step, no framework, no bundler — open the file and it
runs.

## What it does

| | |
|---|---|
| **Transcription** | Groq Whisper (`verbose_json`), with segment timestamps preserved |
| **Any format, any size** | Container detected from magic bytes (mp3/wav/m4a/mp4/ogg/flac/webm), not the file extension — phone recorders routinely emit MP4/AAC named `.mp3` |
| **Large files** | Streaming MP3 frame-boundary splitter keeps peak memory around 1 MB; non-MP3 input is converted in-browser with a vendored ffmpeg.wasm |
| **Course filing** | Transcripts file under the student's enrolled course, from a My-courses roster in localStorage, falling back to a two-stage classification pass over the vendored StMU catalog |
| **Readability pass** | Optional chunked LLM cleanup: punctuation, fillers, false starts, paragraphs, section headings, misheard terms — plus a key-points summary |
| **Output** | Clean and timestamped views, copy to clipboard, `.txt` and `.doc` download, zip export grouped by course |
| **UI** | Dark, responsive, mobile-friendly |

The API key lives in the user's `localStorage` and is never committed or
hardcoded. There is no telemetry and no analytics; the only outbound calls are
to the Groq API.

## Design constraints

These are the rules the app is built to, and the reasons behind them.

- **Single file.** `index.html` stays self-contained apart from `vendor/`.
  Vendoring ffmpeg (`ffmpeg.js`, `814.ffmpeg.js`, `ffmpeg-core.js`,
  `ffmpeg-core.wasm`) rather than pulling it from a CDN is what made
  conversion work at all: browsers refuse cross-origin Worker scripts, and
  every blob-URL and CDN loading strategy failed at `importScripts()` of the
  core. Same-origin assets are unglamorous and they load.
- **Memory over cleverness on mobile.** The streaming splitter exists because
  a phone browser was killing the tab. Nothing on the main path reads a whole
  file with `arrayBuffer()`.
- **Model retirement is expected.** Each LLM role tries a fallback list, so
  when Groq retires a model the feature degrades instead of erroring.
- **Version discipline.** The `VERSION` constant bumps on every change, and
  the version chip on the page is how a deploy is confirmed to have landed —
  stale caches otherwise make debugging a guessing game.
- **An honest failure path.** When conversion genuinely cannot work, the app
  says exactly what the file is and what command would fix it, rather than
  failing silently.

## Tests

Playwright drives the real page over http (not `file://`, whose origin
semantics differ), asserting no console errors, uploading a large MP4/AAC
fixture, and checking that conversion completes and produces a smaller MP3.

```sh
npm install
npx playwright install chromium
npx playwright test                                    # Chromium
npx playwright test -c playwright.firefox.config.js    # Firefox
npx playwright test tests/mobile.spec.js               # mobile emulation
```

Generate the large fixture rather than committing it:

```sh
ffmpeg -f lavfi -i "sine=frequency=440:duration=1800" -c:a aac -b:a 192k fixture.m4a
```

A 30-minute sine at 192 kbps lands around 40 MB — over the conversion
threshold, quick to produce, and it exercises the real path.

## Course catalog

`vendor/stmu-courses.js` holds 1,486 undergraduate courses scraped from
`catalog.stmarytx.edu` (~60 KB, lazy-loaded). A monthly GitHub Action
re-scrapes it and commits only on a real change, bumping the version patch so
the deploy is visible on the chip. Sanity guards refuse to overwrite the map
if the site layout shifts — fewer than 40 subject prefixes or 1,000 courses
fails the run loudly rather than silently publishing a broken catalog.
Classification results are validated against the map, so a hallucinated course
number cannot create a folder.
