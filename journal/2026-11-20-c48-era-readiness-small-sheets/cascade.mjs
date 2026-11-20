#!/usr/bin/env node
// C48: proof that splitting a stylesheet into layout rules and look-only stretches changed no cascade, for every page
// and state, not only the ones the screenshots reach.
//
//   node cascade.mjs <git ref> <file.css>...     (paths relative to the repo root, e.g. web/app/altstore.css)
//
// For each file it reads the version at <ref> and the working copy, drops comments, substitutes every custom property
// the working copy's :root blocks add (the new iOS 6 decoration tokens) back into the values that read it, and then
// compares two ordered lists: every look declaration and every layout declaration (ios6-css.test.js's LOOK), each as
// (at-rule, selector, property, value, !important). Look and layout properties never share a shorthand, so when both
// lists are the same, in the same order, every element gets the same winner for every property: same specificity,
// same file, same relative order. Exit 0 when every file matches.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LOOK = /^(--.+|color|color-scheme|accent-color|caret-color|opacity|filter|-webkit-backdrop-filter|backdrop-filter|box-shadow|text-shadow|content|background(-[a-z]+)*|border(-[a-z]+)*|outline(-[a-z]+)*|-webkit-mask(-[a-z]+)*|mask(-[a-z]+)*|font(-[a-z]+)*|line-height|letter-spacing|word-spacing|text-align|text-transform|text-decoration(-[a-z]+)*|-webkit-font-smoothing|-webkit-text-stroke(-[a-z]+)*|fill|stroke(-[a-z]+)*|list-style(-[a-z]+)*)$/;

const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();

// Split on `sep` outside quotes and parentheses.
function splitTop(s, sep) {
  const out = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ""; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// [{ at, sel, prop, value, important }] in source order; nested blocks (@media, @keyframes) carry their prelude.
function decls(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (s, at) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf("{", i);
      if (open < 0) break;
      const prelude = norm(s.slice(i, open));
      let depth = 1, j = open + 1, quote = "";
      for (; j < s.length && depth; j++) {
        const ch = s[j];
        if (quote) { if (ch === quote) quote = ""; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      const body = s.slice(open + 1, j - 1);
      if (prelude.startsWith("@")) walk(body, at ? `${at} ${prelude}` : prelude);
      else {
        for (const d of splitTop(body, ";").map((x) => x.trim()).filter(Boolean)) {
          const k = d.indexOf(":");
          let value = norm(d.slice(k + 1));
          const important = /!important$/.test(value);
          value = value.replace(/\s*!important$/, "");
          out.push({ at, sel: prelude, prop: d.slice(0, k).trim().toLowerCase(), value, important });
        }
      }
      i = j;
    }
  };
  walk(text, "");
  return out;
}

const key = (d) => `${d.at ? d.at + " | " : ""}${d.sel} { ${d.prop}: ${d.value}${d.important ? " !important" : ""} }`;

function check(file, ref) {
  const before = decls(execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" }));
  let after = decls(readFileSync(file, "utf8"));
  const beforeRoot = new Set(before.filter((d) => d.sel === ":root").map((d) => d.prop));
  const tokens = new Map(after.filter((d) => !d.at && d.sel === ":root" && d.prop.startsWith("--") && !beforeRoot.has(d.prop)).map((d) => [d.prop, d.value]));
  after = after.filter((d) => !(d.sel === ":root" && tokens.has(d.prop)));
  const sub = (v) => { for (let n = 0; n < 5; n++) v = v.replace(/var\((--[\w-]+)\)/g, (m, t) => (tokens.has(t) ? tokens.get(t) : m)); return norm(v); };
  after = after.map((d) => ({ ...d, value: sub(d.value) }));
  let bad = 0;
  // @keyframes steps aren't in the cascade with the rules: their own list
  const kf = (d) => /@keyframes/.test(d.at);
  for (const [name, test] of [["look", (d) => !kf(d) && LOOK.test(d.prop)], ["layout", (d) => !kf(d) && !LOOK.test(d.prop)], ["keyframes", kf]]) {
    const a = before.filter(test).map(key), b = after.filter(test).map(key);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        console.log(`${file}: ${name} #${i} differs\n  before: ${a[i] ?? "(none)"}\n  after:  ${b[i] ?? "(none)"}`);
        bad++;
        break;
      }
    }
    if (!bad) console.log(`${file}: ${name} same (${a.length} declarations)`);
  }
  // tokens that nothing reads are dead weight
  const used = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const t of tokens.keys()) if (!used.includes(`var(${t})`)) { console.log(`${file}: token ${t} is never used`); bad++; }
  console.log(`${file}: ${tokens.size} new tokens`);
  return bad;
}

const [ref, ...files] = process.argv.slice(2);
let bad = 0;
for (const f of files) bad += check(f, ref);
console.log(bad ? `${bad} problems` : "same cascade");
process.exit(bad ? 1 : 0);
