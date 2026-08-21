#!/usr/bin/env node
// Bumps the patch component of the VERSION constant in index.html.
// Used by the scheduled catalog refresh so a data-only deploy is still
// visible on the version chip.
const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "index.html");
let s = fs.readFileSync(p, "utf8");
let bumped = null;
s = s.replace(/(const VERSION\s*=\s*")(\d+)\.(\d+)\.(\d+)[^"]*(")/,
  (all, pre, a, b, c, post) => {
    bumped = `${a}.${b}.${+c + 1}-catalog`;
    return `${pre}${bumped}${post}`;
  });
if (!bumped) { console.error("VERSION constant not found"); process.exit(1); }
fs.writeFileSync(p, s);
console.log("VERSION ->", bumped);
