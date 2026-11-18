// F182: the client side of user reviews (core/reviews.js): the draft's caps, the device token, the API calls and
// how ours merge with a depiction's and the App Store's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDraft, deviceToken, reviewsApi, mergeReviews, reviewDate, ourReview, reviewsBase, TOKEN_KEY, LIMITS } from "./reviews.js";

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test("a draft: stars 1-5, the caps, a written review wants a title, stars alone are fine", () => {
  assert.equal(checkDraft({}).field, "stars");
  assert.equal(checkDraft({ stars: 6 }).ok, false);
  assert.deepEqual(checkDraft({ stars: 4 }), { ok: true, draft: { stars: 4, title: "", name: "", text: "", version: "" } });
  assert.equal(checkDraft({ stars: 5, text: "Good" }).field, "title");
  assert.equal(checkDraft({ stars: 5, title: "x".repeat(LIMITS.title + 1) }).field, "title");
  assert.equal(checkDraft({ stars: 5, title: "T", name: "n".repeat(31) }).field, "name");
  assert.equal(checkDraft({ stars: 5, title: "T", text: "t".repeat(2001) }).error, "Review is at most 2,000 characters.");
  assert.equal(checkDraft({ stars: 5, title: "😀".repeat(80) }).ok, true, "characters, not UTF-16 units");
  assert.deepEqual(checkDraft({ stars: "3", title: " Hi ", name: " Ann ", text: " ok ", version: "2.1" }).draft, { stars: 3, title: "Hi", name: "Ann", text: "ok", version: "2.1" });
});

test("the device token: made once, kept in localStorage; the app's Keychain when the shell has it", async () => {
  const storage = memStore();
  const rand = (n) => new Uint8Array(n).fill(7);
  const t = await deviceToken({ storage, native: null, rand });
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(storage.getItem(TOKEN_KEY), t);
  assert.equal(await deviceToken({ storage, native: null, rand: () => new Uint8Array(32).fill(9) }), t, "the same one next time");
  // a shell with reviews.token.*: it keeps it
  const kept = {};
  const native = { call: async (m, p) => { if (m === "reviews.token.get") return kept.token ?? null; if (m === "reviews.token.set") kept.token = p.token; return true; } };
  const s2 = memStore();
  const t2 = await deviceToken({ storage: s2, native, rand });
  assert.equal(kept.token, t2);
  s2.m.clear();
  assert.equal(await deviceToken({ storage: s2, native, rand: () => new Uint8Array(32).fill(1) }), t2, "the Keychain outlives web storage");
  // a shell without them: localStorage
  const old = { call: async () => { throw new Error("unknown method"); } };
  const s3 = memStore();
  const t3 = await deviceToken({ storage: s3, native: old, rand });
  assert.equal(s3.getItem(TOKEN_KEY), t3);
});

test("the API: list, post, report with the token; anything that isn't the server's JSON reads as off", async () => {
  const calls = [];
  const answer = (status, body, type = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": type } });
  let next = () => answer(200, { enabled: true, average: 4, count: 2, histogram: [1, 1, 0, 0, 0], reviews: [{ id: "a", stars: 5 }], more: false, mine: null });
  const fetcher = async (url, init = {}) => { calls.push({ url, init }); return next(); };
  const api = reviewsApi({ base: "https://ifizbox.example", fetcher, token: async () => "t".repeat(40) });
  const l = await api.list("com.example.a b");
  assert.equal(calls[0].url, "https://ifizbox.example/reviews/com.example.a%20b?page=0");
  assert.equal(calls[0].init.headers["X-Review-Token"], "t".repeat(40));
  assert.deepEqual([l.enabled, l.count, l.reviews.length], [true, 2, 1]);
  next = () => answer(200, "<!doctype html><title>app</title>", "text/html");
  assert.equal((await api.list("x")).enabled, false, "the website's index.html (no reviews route there)");
  next = () => { throw new TypeError("offline"); };
  const off = await api.list("x");
  assert.deepEqual([off.enabled, off.error], [false, "network"]);
  next = () => answer(200, { ok: true, review: { id: "r" } });
  assert.equal((await api.post("x", { stars: 5 })).review.id, "r");
  const post = calls.at(-1);
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(post.init.body), { stars: 5 });
  next = () => answer(429, { code: "rate_limited", error: "Too many reviews from here. Try again in a minute." });
  await assert.rejects(api.post("x", { stars: 5 }), { code: "rate_limited", message: /Too many/ });
  next = () => answer(200, { ok: true, hidden: true });
  assert.equal((await api.report("x", "0123456789abcdef")).hidden, true);
  assert.equal(calls.at(-1).url, "https://ifizbox.example/reviews/x/0123456789abcdef/report");
  next = () => { throw new TypeError("offline"); };
  await assert.rejects(api.report("x", "0123456789abcdef"), { code: "network" });
  assert.equal(reviewsBase("site"), "");
  assert.match(reviewsBase("jailbreak"), /^https:\/\//);
});

test("merging: ours alone keep the bar chart; with others, a count-weighted average and where each comes from", () => {
  const now = Date.UTC(2026, 10, 18);
  const ours = { enabled: true, average: 4, count: 2, histogram: [1, 1, 0, 0, 0], more: false,
    reviews: [{ id: "a1", stars: 5, title: "Great", name: "Ann", text: "<b>x</b>", version: "2.1.3", date: Date.UTC(2026, 10, 14, 12), updated: Date.UTC(2026, 10, 14, 12) }] };
  let m = mergeReviews({ ours, now });
  assert.deepEqual(m.rating, { average: 4, count: 2, noun: "Ratings", histogram: [1, 1, 0, 0, 0] });
  assert.deepEqual(m.reviews[0], { ours: true, id: "a1", title: "Great", author: "Ann", rating: 5, version: "2.1.3", date: "Nov 14", text: "<b>x</b>" });
  assert.equal(m.footer, "Ratings and reviews from reviews written here.");

  const depiction = { average: 3, count: 2, noun: "Reviews", reviews: [{ title: "Meh", author: "dev", rating: 3, text: "**bold**", raw: false }] };
  const appStore = { average: 5, count: 6, noun: "Ratings" };
  m = mergeReviews({ ours, depiction, appStore, now });
  assert.equal(m.rating.average, Math.round(((4 * 2 + 3 * 2 + 5 * 6) / 10) * 10) / 10);
  assert.equal(m.rating.count, 10);
  assert.equal(m.rating.histogram, undefined, "no bars when only some sources have them");
  assert.equal(m.rating.from, "2 from users here, 2 in the depiction, 6 on the App Store.");
  assert.deepEqual(m.reviews.map((r) => r.title), ["Great", "Meh"], "ours first, then the depiction's");
  assert.equal(m.reviews[1].ours, undefined);
  assert.equal(m.footer, "Ratings and reviews from reviews written here, the package's depiction and the App Store.");

  // the server off, or nobody rated yet here: the others as they were
  m = mergeReviews({ ours: { enabled: false, count: 0, reviews: [] }, appStore, now });
  assert.deepEqual(m.rating, { average: 5, count: 6, noun: "Ratings" });
  assert.equal(mergeReviews({}).rating, null);
  assert.equal(mergeReviews({}).footer, "No ratings or reviews yet.");
  assert.equal(mergeReviews({ ours: { enabled: true, count: 0, reviews: [] } }).rating, null);
});

test("B37: the App Store's written reviews are a third list with its own label, not mixed into ours", () => {
  const now = Date.UTC(2026, 10, 18);
  const ours = { enabled: true, average: 4, count: 1, histogram: [0, 1, 0, 0, 0], reviews: [{ id: "a1", stars: 4, title: "Mine", name: "Ann", text: "x", date: now, updated: now }] };
  const appStore = { average: 4.76, count: 28385, noun: "Ratings", reviews: [{ appStore: true, title: "Cool update", author: "D", rating: 5, version: "2.0.1", at: Date.UTC(2026, 10, 17, 12), text: "y" }] };
  let m = mergeReviews({ ours, appStore, now });
  assert.deepEqual(m.reviews.map((r) => r.title), ["Mine"]);
  assert.deepEqual(m.appStoreReviews, [{ appStore: true, title: "Cool update", author: "D", rating: 5, version: "2.0.1", date: "Nov 17", text: "y" }]);
  assert.equal(m.appStoreLabel, "App Store Reviews");
  assert.equal(m.rating.count, 28386);
  // reviews but no rating (a lookup without one): still from the App Store
  m = mergeReviews({ appStore: { reviews: appStore.reviews }, now });
  assert.equal(m.rating, null);
  assert.equal(m.appStoreReviews.length, 1);
  assert.equal(m.footer, "Ratings and reviews from the App Store.");
  assert.deepEqual(mergeReviews({}).appStoreReviews, []);
});

test("dates and our review's cell: 'by name – Version – date', Anonymous without a name", () => {
  const now = Date.UTC(2026, 10, 18);
  assert.equal(reviewDate(Date.UTC(2026, 0, 3, 12), now), "Jan 3");
  assert.equal(reviewDate(Date.UTC(2025, 11, 31, 12), now), "Dec 31, 2025");
  assert.equal(reviewDate(0, now), null);
  assert.equal(ourReview({ id: "x", stars: 2, title: "", name: "", text: "", version: "" }, now).author, "Anonymous");
});
