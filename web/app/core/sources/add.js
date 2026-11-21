// Adding a source of any format (F16): fetch what the user typed, detect() it, and hand back a source record of the
// right kind, so the Add Source alert never asks which kind it is.
//
//   detectSource(backend, input, opts) -> one of
//     { format: "apt", kind: "apt", source }                   source: core/sources.js's record (key deb:…), counted
//     { format, kind: "ipa", source, parsed }                  source: { key alt:…, kind: "altstore", format, uri, … }
//                                                              like core/altstore.js altRecord; parsed: parseIpaSource
//     { format, kind: "ipa", source, parsed: null, reason }    a format we know but can't read (an encrypted GBox
//                                                              source): saved with `unsupported`, so the source page
//                                                              still shows its "Open in" row (F8)
//     { format: "github", kind: "github", repo, source, app }  F304: a GitHub repo's page (core/github.js detectGithub):
//                                                              its releases as a Tweak Source and/or an app source
//   or throws SourceError: invalid_url, verification (backend failure, with its `code`), or not_source
//   (SourceFormatError, with a message that says what the page was).
//
// Order: the URL itself is fetched and detected (a JSON source, a Release, a Packages file in any compression, at
// any of Cydia's paths). When it is a web page or missing (an APT repo's root often is one or the other), the URL
// is checked as a flat APT repo (core/sources.js verifySource), then as dist repos under dists/<d>/ for each `dists`
// candidate. opts: { arch, count, dists: ["stable", …] }.
import { verifySource, refreshSource, sourceKey, normalizeSourceUrl, SourceError, missing, verificationError } from "../sources.js";
import { altKey } from "../altstore.js";
import { DEFAULT_ARCH, repoLayout, parseRelease } from "../apt.js";
import { detect, unwrapLink, SourceFormatError, FORMATS } from "./detect.js";
import { parseIpaSource } from "./ipa.js";
import { githubRepoPage, githubAccountPage, detectGithub, ACCOUNT_MESSAGE } from "../github.js"; // F304

export const DEFAULT_DISTS = ["stable"];

async function bodyOf(backend, url) {
  const res = await backend.fetch(url);
  return new Uint8Array(await res.arrayBuffer());
}

// The record an IPA-format source is kept as: core/altstore.js altRecord's fields plus `format`, so the AltStore
// list (withAltSources) keeps every IPA format.
function ipaRecord(url, format, parsed, reason = null) {
  const rec = {
    key: altKey(url), kind: "altstore", format, uri: url, name: parsed?.name || null, iconURL: parsed?.iconURL ?? null,
    tintColor: parsed?.tintColor ?? null, count: parsed ? parsed.apps.length : null, updated: Date.now(), error: null,
    identifier: parsed?.identifier || null, // B273: tells a source added twice under two URLs
  };
  if (reason) rec.unsupported = reason;
  return rec;
}

async function aptSource(backend, layout, opts) {
  const source = { uri: layout.uri, dist: layout.dist, components: layout.components };
  source.key = sourceKey(source);
  if (!layout.flat && layout.dist !== "./" && !layout.componentsFromRelease) {
    // A Packages URL named one component; a Release lists them all.
    try {
      const text = await backend.text(repoLayout(source).release);
      const r = parseRelease(text);
      if (r.components.length) source.components = r.components;
    } catch (e) {
      if (!missing(e)) throw verificationError(e);
    }
  }
  const fields = await refreshSource(backend, source, opts);
  if (fields.error) throw new SourceError("verification", fields.error);
  const { error, ...rest } = fields;
  return { ...source, ...rest };
}

export async function detectSource(backend, input, { arch = DEFAULT_ARCH, count, dists = DEFAULT_DISTS } = {}) {
  const link = unwrapLink(input);
  if (!link) throw new SourceError("invalid_url");
  const url = link.url;
  const opts = { arch, ...(count ? { count } : {}) };
  // F304: a GitHub repo's page is read through its releases (core/github.js), never as a web page.
  const gh = githubRepoPage(url);
  if (gh) return detectGithub(backend, gh, opts);
  const account = githubAccountPage(url);
  if (account) throw new SourceFormatError(ACCOUNT_MESSAGE(account), "github_account");
  let body = null;
  try {
    body = await bodyOf(backend, url);
  } catch (e) {
    if (!missing(e)) throw verificationError(e);
  }
  let pageError = null;
  if (body) {
    let d = null;
    try {
      d = detect(url, body);
    } catch (e) {
      if (!(e instanceof SourceFormatError)) throw e;
      // A web page or plain garbage may still sit on an APT repo's root: probe before refusing. JSON that is no
      // source format is refused as it is.
      if (e.reason === "bad_json" || e.reason === "unknown_json") throw e;
      pageError = e;
    }
    if (d?.kind === "ipa") {
      if (!d.parsable) return { format: d.format, kind: "ipa", source: ipaRecord(url, d.format, null, d.reason), parsed: null, reason: d.reason };
      let parsed;
      try { parsed = parseIpaSource(d.format, d.json); } catch (e) {
        throw new SourceFormatError(`This ${FORMATS[d.format].name} can't be read: ${e.message}`, "bad_source");
      }
      return { format: d.format, kind: "ipa", source: ipaRecord(url, d.format, parsed), parsed };
    }
    if (d?.kind === "apt") {
      const layout = { ...d.apt, flat: d.apt.dist === "./", componentsFromRelease: Boolean(d.release?.components?.length) };
      return { format: "apt", kind: "apt", source: await aptSource(backend, layout, opts) };
    }
  }
  // A web page, or nothing at that address: try it as an APT repo's root.
  let dir;
  try { dir = normalizeSourceUrl(url); } catch { dir = null; }
  if (dir) {
    try {
      return { format: "apt", kind: "apt", source: await verifySource(backend, dir, opts) };
    } catch (e) {
      if (e?.kind !== "not_repository") throw e;
    }
    for (const dist of dists) {
      const probe = { uri: dir, dist, components: [] };
      let text;
      try { text = await backend.text(repoLayout(probe).release); } catch (e) {
        if (missing(e)) continue;
        throw verificationError(e);
      }
      let d;
      try { d = detect(repoLayout(probe).release, text); } catch { continue; }
      if (d.kind !== "apt" || !d.release) continue;
      const layout = { uri: dir, dist, components: d.release.components.length ? d.release.components : ["main"], flat: false, componentsFromRelease: true };
      return { format: "apt", kind: "apt", source: await aptSource(backend, layout, opts) };
    }
  }
  const what = pageError ? pageError.message : `Nothing was found at ${url}.`;
  throw new SourceFormatError(`${what} There is no APT repository (Release or Packages) there either, and no app `
    + "source (AltStore, ESign, Scarlet or GBox JSON). Check the address: it should be the repository or source "
    + "URL, not a page about it.", pageError?.reason ?? "not_found");
}
