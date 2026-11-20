// GitHub repos as sources (F304). Tweaks such as YTLite (dayanch96/YTLite) or BHTwitter (BandarHL/BHTwitter) ship as
// files on a repo's GitHub releases, with no APT repo: Add Source of github.com/<owner>/<repo> reads the releases
// through GitHub's API (the site's fetch proxy answers those URLs itself, with its token and a ten-minute edge cache:
// worker/src/github.js; the app asks api.github.com directly) and makes the repo
//
//   - a Tweak Source (the sideload app, F302) when its releases carry .deb or .dylib files: one tweak, each release a
//     version of it (one file per release, a rootless .deb first), named and described by the repo, the owner's
//     avatar for its icon. githubPackagesText writes that as a Packages text, so the catalog, the Tweak Sources group,
//     Works In (the filter .plist read from the .deb, core/tweaks.js) and Add Tweak from a Source take it as they take
//     an APT repo's tweaks. The record is an APT-style one (key deb:https://github.com/<o>/<r>/:./) marked `github`.
//   - an app source when its releases carry only .ipa files (or where Tweak Sources aren't kept): an AltStore-list
//     record of format "github" whose uri is the releases API URL; githubToAlt turns the releases into AltStore JSON.
//   - neither: Add Source says so (githubNeitherError) instead of "sent a web page".
//
// Pure apart from `backend.text` calls; SourceError and altKey come in lazily (core/sources.js imports this file).

export const GITHUB_API = "https://api.github.com";
export const RELEASES_PER_PAGE = 30;
export const CACHE_MS = 10 * 60 * 1000; // a repo read again within ten minutes comes from memory
export const NOTES_MAX = 1200; // characters of release notes a package's description carries

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// github.com/<first segment> that is no account (GitHub's own pages)
const RESERVED = new Set(["orgs", "settings", "marketplace", "sponsors", "topics", "features", "login", "apps", "about",
  "explore", "search", "notifications", "pricing", "enterprise", "collections", "trending", "new", "codespaces", "issues", "pulls"]);

function githubUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const parts = u.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { u, parts };
}

// A typed URL that names a repo's page, not a file in it: github.com/<owner>/<repo>, with .git, /releases,
// /releases/latest, /releases/tag/<tag> or /tree/<branch> after it -> { user, repo }; anything else (a file under
// /raw/, /blob/ or /releases/download/, which Add Source reads as it is) -> null.
export function githubRepoPage(input) {
  const g = githubUrl(input);
  if (!g) return null;
  const [user, rawRepo, kind, sub] = g.parts;
  if (!user || !rawRepo || !NAME.test(user) || RESERVED.has(user.toLowerCase())) return null;
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!REPO.test(repo) || repo === "." || repo === "..") return null;
  const n = g.parts.length;
  const ok = kind === undefined || kind === "tree"
    || (kind === "releases" && (n === 3 || (sub === "latest" && n === 4) || (sub === "tag" && n === 5)));
  return ok ? { user, repo } : null;
}

// github.com/<owner> alone (an account, not a repo) -> the owner, else null.
export function githubAccountPage(input) {
  const g = githubUrl(input);
  if (!g || g.parts.length !== 1 || g.u.search) return null;
  const [user] = g.parts;
  return NAME.test(user) && !RESERVED.has(user.toLowerCase()) ? user : null;
}

export const repoApiUrl = ({ user, repo }) => `${GITHUB_API}/repos/${user}/${repo}`;
export const releasesApiUrl = ({ user, repo }) => `${repoApiUrl({ user, repo })}/releases?per_page=${RELEASES_PER_PAGE}`;
export const repoPageUrl = ({ user, repo }) => `https://github.com/${user}/${repo}`;
export const githubTweakUri = (gh) => `${repoPageUrl(gh)}/`; // the Tweak Source record's uri
export const avatarUrl = ({ user }) => `https://github.com/${encodeURIComponent(user)}.png?size=120`;
export const repoLabel = ({ user, repo }) => `github.com/${user}/${repo}`;

// api.github.com/repos/<owner>/<repo>[/…] -> { user, repo }, else null (an app source's uri, for its title and icon).
export function githubApiRepo(url) {
  let u;
  try { u = new URL(String(url ?? "")); } catch { return null; }
  if (u.hostname.toLowerCase() !== "api.github.com") return null;
  const [first, user, repo] = u.pathname.split("/").filter(Boolean);
  return first === "repos" && user && repo && NAME.test(user) && REPO.test(repo) ? { user, repo } : null;
}

// ---- reading -------------------------------------------------------------------------------------------------

const memo = new Map(); // "<owner>/<repo>" lower case -> { at, promise }

export function forgetGithubRepo(gh) {
  if (gh) memo.delete(`${gh.user}/${gh.repo}`.toLowerCase());
  else memo.clear();
}

const parseJson = (text, what) => {
  try { return JSON.parse(String(text ?? "").replace(/^﻿/, "")); } catch { throw new Error(`GitHub's answer for ${what} wasn't JSON.`); }
};

// The repo and its releases -> { info, releases }. Kept CACHE_MS in memory (a failure isn't kept), so Add Source, the
// refresh after it and the catalog's load cost GitHub one pair of calls. `fresh` asks again whatever is kept.
export function readGithubRepo(backend, gh, { now = Date.now(), fresh = false } = {}) {
  const k = `${gh.user}/${gh.repo}`.toLowerCase();
  const hit = memo.get(k);
  if (hit && !fresh && now - hit.at < CACHE_MS) return hit.promise;
  const promise = (async () => {
    const [infoText, relText] = await Promise.all([backend.text(repoApiUrl(gh)), backend.text(releasesApiUrl(gh))]);
    const info = parseJson(infoText, repoLabel(gh));
    const releases = parseJson(relText, `${repoLabel(gh)}'s releases`);
    if (!Array.isArray(releases)) throw new Error(`GitHub's answer for ${repoLabel(gh)}'s releases wasn't a list.`);
    return { info: info && typeof info === "object" ? info : {}, releases: releases.filter((r) => r && typeof r === "object" && !r.draft) };
  })();
  memo.set(k, { at: now, promise });
  promise.catch(() => { if (memo.get(k)?.promise === promise) memo.delete(k); });
  return promise;
}

// ---- assets --------------------------------------------------------------------------------------------------

const assetsOf = (rel) => (Array.isArray(rel?.assets) ? rel.assets : []).filter((a) => a && typeof a.name === "string" && /^https:\/\//i.test(a.browser_download_url ?? ""));
const isDeb = (a) => /\.deb$/i.test(a.name);
const isDylib = (a) => /\.dylib$/i.test(a.name);
const isIpa = (a) => /\.ipa$/i.test(a.name);

// Which file of a release is the tweak: a rootless (arm64) .deb first, then any .deb, a rootful one, a .dylib last.
function tweakScore(a) {
  if (isDylib(a)) return 1;
  if (!isDeb(a)) return 0;
  const n = a.name.toLowerCase();
  if (/rootless|iphoneos-arm64(?!e)|arm64(?!e)/.test(n)) return 4;
  if (/rootful|iphoneos-arm(?!64)/.test(n)) return 2;
  return 3;
}
export function tweakAsset(rel) {
  let best = null;
  for (const a of assetsOf(rel)) if (tweakScore(a) > (best ? tweakScore(best) : 0)) best = a;
  return best;
}
// The app of a release: its first .ipa (a "TrollStore" .tipa build is no .ipa).
export const ipaAsset = (rel) => assetsOf(rel).find(isIpa) ?? null;

// What a repo's releases carry: { tweaks: [{ release, asset }], apps: [{ release, asset }] }, newest release first.
export function githubAssets(releases) {
  const tweaks = [], apps = [];
  for (const rel of Array.isArray(releases) ? releases : []) {
    const t = tweakAsset(rel);
    if (t) tweaks.push({ release: rel, asset: t });
    const i = ipaAsset(rel);
    if (i) apps.push({ release: rel, asset: i });
  }
  return { tweaks, apps };
}

// A release tag as a version: "v5.2.1" -> "5.2.1"; anything apt can't order safely becomes digits and dots of it,
// else the tag with its odd characters replaced.
export function tagVersion(tag) {
  let v = String(tag ?? "").trim().replace(/^(?:v|version|release)[-_.\s]*(?=\d)/i, "");
  v = v.replace(/[^A-Za-z0-9.+~-]+/g, ".").replace(/^[^0-9A-Za-z]+/, "").replace(/\.+$/, "");
  if (!/^[0-9]/.test(v)) v = `0~${v || "0"}`;
  return v;
}

// The tweak's package id: com.github.<owner>.<repo>, in the characters a package name may use.
export function githubPackageId({ user, repo }) {
  const part = (s) => String(s).toLowerCase().replace(/[^a-z0-9+-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  return `com.github.${part(user)}.${part(repo)}`;
}

const oneLine = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
// Release notes as a Packages long description: each line indented, blank lines as " .".
function longDescription(body) {
  const text = String(body ?? "").replace(/\r\n?/g, "\n").trim().slice(0, NOTES_MAX);
  if (!text) return "";
  return text.split("\n").map((l) => (l.trim() ? ` ${l.replace(/\s+$/, "")}` : " .")).join("\n");
}

// The releases' tweak files as a Packages text: one stanza per release (a version of one package), with the file's
// full URL as Filename. `.dylib` files say so in X-GitHub-Asset (screens/tweaks.js takes them as they are).
export function githubPackagesText({ info = {}, releases = [] } = {}, gh) {
  const name = oneLine(info?.name) || gh.repo;
  const description = oneLine(info?.description) || `${name}, from ${repoLabel(gh)}'s releases`;
  const seen = new Set();
  const stanzas = [];
  for (const { release, asset } of githubAssets(releases).tweaks) {
    let version = tagVersion(release.tag_name || release.name);
    while (seen.has(version)) version += "+1"; // two tags that read as one version
    seen.add(version);
    const lines = [
      `Package: ${githubPackageId(gh)}`,
      `Name: ${name}`,
      `Version: ${version}`,
      "Architecture: iphoneos-arm64",
      "Section: Tweaks",
      `Author: ${gh.user}`,
      `Maintainer: ${gh.user}`,
      `Filename: ${asset.browser_download_url}`,
      ...(Number.isFinite(asset.size) ? [`Size: ${asset.size}`] : []),
      `Icon: ${avatarUrl(gh)}`,
      `Homepage: ${repoPageUrl(gh)}`,
      `X-GitHub-Asset: ${isDylib(asset) ? "dylib" : "deb"}`,
      `X-GitHub-Release: ${oneLine(release.html_url) || `${repoPageUrl(gh)}/releases`}`,
      ...(release.prerelease ? ["X-GitHub-Prerelease: yes"] : []),
      `Description: ${description}`,
    ];
    const long = longDescription(release.body);
    stanzas.push(long ? `${lines.join("\n")}\n${long}` : lines.join("\n"));
  }
  return stanzas.length ? `${stanzas.join("\n\n")}\n` : "";
}

// The releases' .ipa files as AltStore source JSON (core/sources/ipa.js toAltSource "github"): one app, each release
// a version. The owner and repo come from the releases' own URLs (the releases API answer is all an app source has).
export function githubToAlt(releases) {
  const list = Array.isArray(releases) ? releases.filter((r) => r && typeof r === "object" && !r.draft) : [];
  let gh = null;
  for (const r of list) {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\//i.exec(String(r.html_url ?? ""));
    if (m) { gh = { user: m[1], repo: m[2] }; break; }
  }
  if (!gh) gh = { user: "github", repo: "releases" };
  const apps = githubAssets(list).apps;
  const versions = apps.map(({ release, asset }) => ({
    version: tagVersion(release.tag_name || release.name),
    date: release.published_at || undefined,
    downloadURL: asset.browser_download_url,
    ...(Number.isFinite(asset.size) ? { size: asset.size } : {}),
    localizedDescription: String(release.body ?? "").slice(0, NOTES_MAX),
  }));
  return {
    name: gh.repo,
    identifier: `${githubPackageId(gh)}.source`,
    iconURL: avatarUrl(gh),
    website: repoPageUrl(gh),
    apps: versions.length ? [{
      name: gh.repo, bundleIdentifier: githubPackageId(gh), developerName: gh.user, iconURL: avatarUrl(gh),
      localizedDescription: `${gh.repo}, from ${repoLabel(gh)}'s releases.`, versions,
    }] : [],
  };
}

// ---- Add Source and Refresh ------------------------------------------------------------------------------------

// Packages in the text, each once (every stanza here is a version of the repo's one tweak).
const countInline = async (text) => new Set([...String(text).matchAll(/^Package: (.+)$/gm)].map((m) => m[1])).size;

// What Add Source says when a GitHub URL is no source; Did Not Find Source, as for any other address.
async function notSource(message, reason) {
  const { SourceFormatError } = await import("./sources/detect.js");
  return new SourceFormatError(message, reason);
}
export const NEITHER_MESSAGE = (gh) => `${repoLabel(gh)} has no tweaks (.deb or .dylib files) and no apps (.ipa files) `
  + "in its GitHub releases, so it can't be added as a source.";
export const githubNeitherError = (gh) => notSource(NEITHER_MESSAGE(gh), "github_empty");
export const TWEAKS_HERE_MESSAGE = (gh) => `${repoLabel(gh)} has tweaks (.deb files) in its GitHub releases but no apps. `
  + "GitHub tweaks are added as Tweak Sources in the app without a jailbreak, which puts them into the apps it signs.";
export const githubTweaksHereError = (gh) => notSource(TWEAKS_HERE_MESSAGE(gh), "github_tweaks");
export const ACCOUNT_MESSAGE = (user) => `github.com/${user} is a GitHub account, not a repository. Add one of its `
  + `repositories instead: github.com/${user}/<repository>.`;

async function readOrExplain(backend, gh, opts) {
  try {
    return await readGithubRepo(backend, gh, opts);
  } catch (e) {
    const is404 = e?.code === "upstream" && (e?.status === 404 || /\bHTTP 404\b/.test(String(e?.message ?? "")));
    if (is404 || e?.code === "not_found") {
      throw await notSource(`${repoLabel(gh)} was not found on GitHub. Check the name (a private repository can't be read).`, "github_missing");
    }
    const { verificationError } = await import("./sources.js");
    throw verificationError(e);
  }
}

// The Tweak Source record for a repo read with readGithubRepo.
export async function githubTweakRecord(gh, data, { count = countInline, now = Date.now() } = {}) {
  const uri = githubTweakUri(gh);
  const text = githubPackagesText(data, gh);
  return {
    key: `deb:${uri}:./`, uri, dist: "./", components: [], github: { user: gh.user, repo: gh.repo },
    name: oneLine(data?.info?.name) || gh.repo, description: oneLine(data?.info?.description) || null,
    count: await count(text, "iphoneos-arm64"), countArch: "iphoneos-arm64", updated: now, reachedAt: now, failures: 0, error: null,
  };
}

// The app source record for a repo whose releases carry .ipa files (withAltSources keeps it with the AltStore ones).
export async function githubAppRecord(gh, data, { now = Date.now() } = {}) {
  const { altKey } = await import("./altstore.js");
  const uri = releasesApiUrl(gh);
  const alt = githubToAlt(data.releases);
  return { key: altKey(uri), kind: "altstore", format: "github", uri, name: oneLine(data?.info?.name) || gh.repo,
    iconURL: avatarUrl(gh), tintColor: null, count: alt.apps.length, updated: now, error: null };
}

// Add Source of a GitHub repo page -> { format: "github", kind: "github", repo, tweaks, apps, source, app }: `source` the
// Tweak Source record (null when no release has a tweak), `app` the app source record (null when none has an .ipa).
// Throws SourceFormatError when the repo is missing or has neither, SourceError("verification") when GitHub can't be
// read (rate limited, offline).
export async function detectGithub(backend, gh, { count } = {}) {
  const data = await readOrExplain(backend, gh);
  const { tweaks, apps } = githubAssets(data.releases);
  if (!tweaks.length && !apps.length) throw await githubNeitherError(gh);
  return {
    format: "github", kind: "github", repo: gh, tweaks: tweaks.length, apps: apps.length,
    source: tweaks.length ? await githubTweakRecord(gh, data, count ? { count } : {}) : null,
    app: apps.length ? await githubAppRecord(gh, data) : null,
  };
}

// Refresh of a GitHub Tweak Source: core/sources.js refreshSource's fields ({ count, updated, error, name? }).
export async function refreshGithubSource(backend, source, { count = countInline } = {}) {
  const out = { updated: Date.now(), error: null, countArch: "iphoneos-arm64" };
  try {
    const gh = source.github;
    const data = await readGithubRepo(backend, gh, { fresh: true });
    const rec = await githubTweakRecord(gh, data, { count, now: out.updated });
    out.count = rec.count;
    out.name = rec.name;
    out.description = rec.description;
  } catch (e) {
    out.error = e?.message || String(e);
  }
  return out;
}

// The catalog's text for a GitHub Tweak Source (web/app/catalog.js): { text, root }.
export async function githubSourceText(backend, source) {
  const data = await readGithubRepo(backend, source.github);
  return { text: githubPackagesText(data, source.github), root: source.uri };
}

export const isGithubSource = (s) => Boolean(s?.github?.user && s?.github?.repo);
