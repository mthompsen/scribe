#!/usr/bin/env node
// Regenerates vendor/stmu-courses.js from the St. Mary's University
// undergraduate catalog. Fails loudly (non-zero exit) rather than write a
// suspiciously small map, so a catalog site redesign can't silently wipe
// the vendored data.
const fs = require("fs");
const path = require("path");

const BASE = "https://catalog.stmarytx.edu/undergraduate/course-descriptions/";
const OUT = path.join(__dirname, "..", "vendor", "stmu-courses.js");

(async () => {
  const idx = await (await fetch(BASE)).text();
  const prefixes = [...new Set(
    [...idx.matchAll(/href="\/undergraduate\/course-descriptions\/([a-z]+)\/"/g)].map(m => m[1])
  )];
  if (prefixes.length < 40)
    throw new Error(`only ${prefixes.length} subject pages found — catalog layout may have changed`);

  const map = {};
  for (const p of prefixes) {
    const html = await (await fetch(BASE + p + "/")).text();
    const re = /courseblocktitle"><strong>([A-Z]{2,4})\s+(\w{4})\.\s+(.+)\.\s+[\d.]+(?:\s*(?:-|to)\s*[\d.]+)?\s+Semester Hours?\.?<\/strong>/g;
    let m, n = 0;
    while ((m = re.exec(html))) {
      map[`${m[1]} ${m[2]}`] = m[3].replace(/\s+/g, " ").trim();
      n++;
    }
    console.log(`${p}: ${n}`);
  }

  const keys = Object.keys(map).sort();
  if (keys.length < 1000)
    throw new Error(`only ${keys.length} courses scraped — refusing to overwrite the map`);

  const date = new Date().toISOString().slice(0, 10);
  const body = keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(map[k])}`).join(",\n");
  fs.writeFileSync(OUT,
`// St. Mary's University (San Antonio) undergraduate course map.
// Generated ${date} from ${BASE}
// ${keys.length} courses. Regenerate with: node scripts/scrape-catalog.js
window.STMU_COURSES = {
${body}
};
`);
  console.log(`TOTAL: ${keys.length} -> ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
