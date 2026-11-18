// F182: user reviews, the client side of the Worker's /reviews/<package id> (worker/src/reviews.js). Pure JS: the
// Reviews tab and the Write a Review sheet (screens/reviews.js) draw what this returns.
// SPDX-License-Identifier: GPL-3.0-or-later
//
//   LIMITS                                   the server's caps: title 80, name 30, text 2000 (characters)
//   checkDraft({ stars, title, name, text, version }) -> { ok, draft } | { ok: false, error, field }
//   deviceToken({ storage, native, rand })   -> Promise<token>  this device's one random token, made once: the app's
//     Keychain (native reviews.token.get/set) where the shell has it, else localStorage (`ifizbox.reviewToken`)
//   reviewsApi({ base, fetcher, token })     -> { list(id, page), post(id, draft), report(id, reviewId) }
//     list() answers { enabled: false, ... } when the server keeps no reviews (an older or self-hosted Worker,
//     anything that isn't its JSON), so the tab still shows the depiction's and the App Store's.
//   reviewsBase(mode)                         "" on the website (its own origin), the app's server in the app
//   mergeReviews({ ours, depiction, appStore }) -> { rating, reviews, appStoreReviews, appStoreLabel, footer }  one
//     ratings card, one list (ours, the depiction's) and B37's App Store reviews (appStore.reviews) as a list of its own
//   reviewDate(ms, now)                       "Nov 14" this year, "Nov 14, 2025" before
//
// Our reviews carry { ours: true, id } so the tab can offer Report on them; a depiction's carry what
// core/previews.js sileoRatings gave. Text is always plain: the tab draws ours with textContent.
import { ACCOUNT_BASE } from "./account.js";

export const LIMITS = { title: 80, name: 30, text: 2000, version: 64 };
export const TOKEN_KEY = "ifizbox.reviewToken";
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const chars = (s) => [...String(s ?? "")].length;

export function checkDraft({ stars, title = "", name = "", text = "", version = "" } = {}) {
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, field: "stars", error: "Tap a star to rate." };
  const d = { stars: n, title: String(title).trim(), name: String(name).trim(), text: String(text).trim(), version: String(version ?? "").slice(0, LIMITS.version) };
  for (const [k, label] of [["title", "Title"], ["name", "Name"], ["text", "Review"]]) {
    if (chars(d[k]) > LIMITS[k]) return { ok: false, field: k, error: `${label} is at most ${LIMITS[k].toLocaleString("en-US")} characters.` };
  }
  // A written review wants a title, as the App Store's did; stars alone (Tap to Rate) need nothing else.
  if (d.text && !d.title) return { ok: false, field: "title", error: "Give your review a title." };
  return { ok: true, draft: d };
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function deviceToken({ storage = globalThis.localStorage, native = globalThis.ifizboxNative,
  rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) } = {}) {
  const valid = (t) => (typeof t === "string" && TOKEN.test(t) ? t : null);
  let kept = null;
  if (native?.call) {
    try { kept = valid(await native.call("reviews.token.get", {}).then((v) => (typeof v === "string" ? v : v?.token))); } catch { native = null; } // a shell without it
  }
  if (!kept) { try { kept = valid(storage?.getItem(TOKEN_KEY)); } catch { /* storage off */ } }
  const token = kept ?? b64url(rand(32));
  if (native?.call && !kept) await native.call("reviews.token.set", { token }).catch(() => {});
  try { if (storage?.getItem(TOKEN_KEY) !== token) storage?.setItem(TOKEN_KEY, token); } catch { /* full or off */ }
  return token;
}

export const reviewsBase = (mode) => (mode === "site" ? "" : ACCOUNT_BASE);

export class ReviewError extends Error {
  constructor(code, message) { super(message); this.name = "ReviewError"; this.code = code; }
}

const OFF = Object.freeze({ enabled: false, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], page: 0, more: false, mine: null });

export function reviewsApi({ base = "", fetcher = (...a) => globalThis.fetch(...a), token = () => deviceToken() } = {}) {
  const url = (id, rest = "") => `${base}/reviews/${encodeURIComponent(id)}${rest}`;
  const headers = async (extra = {}) => ({ "X-Review-Token": await token(), ...extra });
  const send = async (u, init) => {
    let r;
    try { r = await fetcher(u, { cache: "no-store", ...init }); } catch {
      throw new ReviewError("network", "The review server can't be reached. Check the connection.");
    }
    let body = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) throw new ReviewError(body?.code ?? (r.status === 429 ? "rate_limited" : "server"), body?.error ?? `The review server answered HTTP ${r.status}.`);
    return body;
  };
  return {
    async list(id, page = 0) {
      let r, body;
      try {
        r = await fetcher(url(id, `?page=${page}`), { cache: "no-store", headers: await headers() });
        body = r.ok && /json/.test(r.headers.get("content-type") ?? "") ? await r.json() : null;
      } catch { body = null; }
      if (!body || typeof body !== "object" || !Array.isArray(body.reviews)) return { ...OFF, error: r ? null : "network" };
      return { ...OFF, ...body, enabled: body.enabled !== false };
    },
    post: async (id, draft) => send(url(id), { method: "POST", headers: await headers({ "Content-Type": "application/json" }), body: JSON.stringify(draft) }),
    report: async (id, reviewId) => send(url(id, `/${reviewId}/report`), { method: "POST", headers: await headers() }),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function reviewDate(ms, now = Date.now()) {
  const d = new Date(Number(ms));
  if (!Number.isFinite(d.getTime()) || !ms) return null;
  const s = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? s : `${s}, ${d.getFullYear()}`;
}

// One of ours as the tab's review cell: "by Ann – Version 2.1.3 – Nov 14".
export const ourReview = (rv, now = Date.now()) => ({ ours: true, id: rv.id, title: rv.title, author: rv.name || "Anonymous",
  rating: rv.stars, version: rv.version || null, date: reviewDate(rv.updated || rv.date, now), text: rv.text });

const counted = (r) => r && Number.isFinite(Number(r.average)) && r.average !== null && Number(r.count) > 0;

// ours: reviewsApi().list()'s answer (or null); depiction: sileoRatings() (or null); appStore: { average, count }
// from core/applookup.js (or null). The rating is the count-weighted average of those that give both; the bar chart
// only when every one counted gives one (ours always does, the others never), so it is ours alone or none.
export function mergeReviews({ ours = null, depiction = null, appStore = null, now = Date.now() } = {}) {
  const parts = [];
  if (ours?.enabled && ours.count > 0) parts.push({ average: ours.average, count: ours.count, histogram: ours.histogram, noun: "Ratings", label: (n) => `${n} from ${n === 1 ? "a user" : "users"} here` });
  if (counted(depiction)) parts.push({ average: depiction.average, count: depiction.count, noun: depiction.noun ?? "Reviews", label: (n) => `${n} in the depiction` });
  else if (depiction && depiction.average != null) parts.push({ average: depiction.average, count: 0, noun: "Reviews", label: () => "the depiction's" });
  if (counted(appStore)) parts.push({ average: appStore.average, count: appStore.count, noun: "Ratings", label: (n) => `${n.toLocaleString("en-US")} on the App Store` });
  let rating = null;
  if (parts.length === 1) {
    const p = parts[0];
    rating = { average: Number(p.average), count: p.count || null, noun: p.noun, ...(p.histogram ? { histogram: p.histogram } : {}) };
  } else if (parts.length > 1) {
    const withCount = parts.filter((p) => p.count > 0);
    const total = withCount.reduce((n, p) => n + p.count, 0);
    const average = total ? withCount.reduce((n, p) => n + p.average * p.count, 0) / total : parts.reduce((n, p) => n + Number(p.average), 0) / parts.length;
    rating = { average: Math.round(average * 10) / 10, count: total || null, noun: "Ratings",
      from: parts.map((p) => p.label(p.count)).join(", ").replace(/^./, (c) => c.toUpperCase()) + "." };
  }
  const reviews = [...(ours?.reviews ?? []).map((rv) => ourReview(rv, now)), ...(depiction?.reviews ?? [])];
  // B37: the App Store's written reviews (core/applookup.js parseStoreReviews) as a third list, under its own label.
  const appStoreReviews = (Array.isArray(appStore?.reviews) ? appStore.reviews : []).map((rv) => appStoreReview(rv, now));
  const fromStore = counted(appStore) || appStoreReviews.length > 0;
  const said = [ours?.enabled ? "reviews written here" : null, depiction ? "the package's depiction" : null, fromStore ? "the App Store" : null].filter(Boolean);
  const footer = said.length ? `Ratings and reviews from ${said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said[0]}.` : "No ratings or reviews yet.";
  return { rating, reviews, appStoreReviews, appStoreLabel: "App Store Reviews", footer };
}

// B37: one App Store review as the tab's cell: "by name – Version 2.0.1 – Nov 17" (plain text, drawn with textContent).
export const appStoreReview = (rv, now = Date.now()) => ({ appStore: true, title: rv.title, author: rv.author || null,
  rating: rv.rating ?? null, version: rv.version || null, date: rv.at ? reviewDate(rv.at, now) : null, text: rv.text });

// F206: the ratings card's bars when the source gives no histogram: the written reviews we have (ours, the
// depiction's, the App Store's), counted by their whole stars, as [n5, n4, n3, n2, n1]. A review with no rating, or one
// outside 1-5, isn't counted. `starsOf(review)`: a review's whole stars (a half rounds up), or null.
export const starsOf = (rv) => {
  const n = Math.round(Number(rv?.rating ?? rv?.stars));
  return rv && (rv.rating ?? rv.stars) != null && n >= 1 && n <= 5 ? n : null;
};
export function starCounts(reviews = []) {
  const h = [0, 0, 0, 0, 0];
  for (const rv of reviews) { const n = starsOf(rv); if (n) h[5 - n]++; }
  return h;
}
// F206: only the reviews with `stars` whole stars (null: all of them).
export const withStars = (reviews = [], stars = null) => (stars ? reviews.filter((rv) => starsOf(rv) === stars) : [...reviews]);
