// apt's own source files and lists directory, read by the app's backend (backend-native.js, N3). Pure JS.
//
//   parseAptSources(files)   [{ path, text }] (sources.list, sources.list.d/*.list and *.sources) -> [source]
//   listFileName(url)        a URL's file name in apt's lists directory (apt's URItoFileName)
//
// A source here has the shape core/sources.js uses ({ key, uri, dist, components }) plus `file`, the path it
// came from. Only `deb` entries count (not deb-src); deb822 stanzas with `Enabled: no` are skipped; the first
// file to name a source wins, as apt warns about and ignores repeats.
import { parseSourceLine } from "./apt.js";
import { sourceKey } from "./sources.js";

// One-line format (sources.list(5)): `deb [options] uri suite [component...]`.
export function parseListFile(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const { type, uri, dist, components } = parseSourceLine(line);
    if (type !== "deb" || !uri || !dist) continue;
    out.push({ uri, dist, components });
  }
  return out;
}

// deb822 format (`Types: deb`, `URIs:`, `Suites:`, `Components:`): one source per URI x suite.
export function parseDeb822File(text) {
  const out = [];
  const stanzas = String(text ?? "").replace(/\r/g, "").split(/\n[ \t]*\n/);
  for (const stanza of stanzas) {
    const fields = {};
    let last = null;
    for (const raw of stanza.split("\n")) {
      if (/^\s*#/.test(raw)) continue;
      if (/^[ \t]/.test(raw) && last) { fields[last] += " " + raw.trim(); continue; }
      const m = raw.match(/^([^:\s]+)\s*:\s*(.*)$/);
      if (!m) continue;
      last = m[1].toLowerCase();
      fields[last] = m[2].trim();
    }
    const words = (k) => (fields[k] ?? "").split(/\s+/).filter(Boolean);
    if (!words("types").includes("deb")) continue;
    if (/^(no|false|0)$/i.test(fields.enabled ?? "")) continue;
    for (const uri of words("uris")) {
      for (const dist of words("suites")) out.push({ uri, dist, components: dist.endsWith("/") ? [] : words("components") });
    }
  }
  return out;
}

const normUri = (uri) => uri.replace(/\/*$/, "/");

export function parseAptSources(files) {
  const seen = new Map();
  for (const { path, text } of files ?? []) {
    const entries = /\.sources$/.test(path) ? parseDeb822File(text) : parseListFile(text);
    for (const e of entries) {
      if (!/^https?:\/\//i.test(e.uri)) continue; // cdrom:, file:, mirror+: nothing either backend can fetch
      const s = { uri: normUri(e.uri), dist: e.dist, components: e.components, file: path };
      s.key = sourceKey(s);
      if (!seen.has(s.key)) seen.set(s.key, s);
    }
  }
  return [...seen.values()];
}

// apt's URItoFileName (apt-pkg/contrib/strutl.cc): drop the scheme and any user:password, quote the characters
// apt quotes as %xx (lower-case hex), then turn every "/" into "_". A flat repo's index is "<uri>./Packages".
const QUOTED = new Set("\\|{}[]<>\"^~_=!@#$%^&*");

export function listFileName(url) {
  const s = String(url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^/@]*@/, "");
  let out = "";
  for (const ch of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(ch);
    out += ch <= 0x20 || ch >= 0x7f || QUOTED.has(c) ? "%" + ch.toString(16).padStart(2, "0") : c;
  }
  return out.replace(/\//g, "_");
}

// The list file names apt may have written for an index URL (a Packages, Release or InRelease file). A flat
// repo's files sit in the source's URI, and apt names them "<uri>./<file>" (so "repo.example_._Packages"); try
// that first, then the plain name. A dists/ URL has one name.
export function listNamesFor(url) {
  const plain = listFileName(url);
  if (/\/dists\//.test(url)) return [plain];
  return [listFileName(url.replace(/[^/]*$/, (f) => "./" + f)), plain];
}
