// F182: the Write a Review sheet and the Reviews tab with reviews written here (screens/reviews.js), over a small
// fake DOM: Send checks the draft and closes once sent, Cancel sends nothing, Tap to Rate keeps a written review's
// words, Report asks first and only shows on other people's reviews, More Reviews pages ours in before the
// depiction's, and a server without reviews leaves the depiction's and the App Store's as they were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDocument as fakeDom, tick } from "../fakes.test-helper.js";

globalThis.document = fakeDom();
const { writeReviewSheet, reviewsTab, starPicker } = await import("./reviews.js");

const all = (n, out = []) => { for (const c of n.children ?? []) { out.push(c); all(c, out); } return out; };
const find = (n, cls) => all(n).filter((x) => x._cls?.has(cls));
const one = (n, cls) => find(n, cls)[0];
const byText = (n, text) => all(n).find((x) => x.tagName === "BUTTON" && x.textContent === text);

test("the star picker: tap sets it, aria says which", async () => {
  let picked = null;
  const p = starPicker(2, (n) => { picked = n; });
  assert.equal(p.buttons.filter((b) => b._cls.has("on")).length, 2);
  await p.buttons[3].click();
  assert.deepEqual([picked, p.value(), p.buttons[3].attrs["aria-checked"]], [4, 4, "true"]);
  assert.equal(p.buttons.filter((b) => b._cls.has("on")).length, 4);
});

test("Write a Review: Cancel / Send, the stars, Title, Name, Review; Send checks first and closes once sent", async () => {
  document.body.replaceChildren();
  const sent = [];
  let fail = null;
  const s = writeReviewSheet({ version: "2.1.3", onSend: async (d) => { if (fail) throw new Error(fail); sent.push(d); } });
  assert.equal(document.body.children.includes(s.sheet), true);
  assert.equal(one(s.sheet, "nav-title").textContent, "Write a Review");
  assert.ok(byText(s.sheet, "Cancel") && byText(s.sheet, "Send"));
  assert.match(one(s.sheet, "review-note").textContent, /Reviewing version 2\.1\.3\. One review per package per device/);
  assert.deepEqual([s.fields.title.input.maxLength, s.fields.name.input.maxLength, s.fields.text.input.maxLength], [80, 30, 2000]);
  assert.equal(s.fields.text.input.tagName, "TEXTAREA");

  await byText(s.sheet, "Send").click();
  assert.equal(sent.length, 0);
  assert.equal(s.error.hidden, false);
  assert.equal(s.error.textContent, "Tap a star to rate.");
  await s.stars.buttons[3].click();
  assert.equal(s.error.hidden, true, "tapping a star clears it");
  s.fields.text.input.value = "Feels like a new phone";
  await byText(s.sheet, "Send").click();
  assert.equal(s.error.textContent, "Give your review a title.");
  s.fields.title.input.value = "Great";
  s.fields.name.input.value = "Ann";
  fail = "Too many reviews from here. Try again in a minute.";
  await byText(s.sheet, "Send").click();
  assert.equal(s.error.textContent, fail, "the server's reason, and the sheet stays");
  assert.equal(s.closed(), false);
  fail = null;
  await byText(s.sheet, "Send").click();
  assert.deepEqual(sent, [{ stars: 4, title: "Great", name: "Ann", text: "Feels like a new phone", version: "2.1.3" }]);
  assert.equal(s.closed(), true);
  assert.equal(document.body.children.includes(s.sheet), false);

  const e = writeReviewSheet({ initial: { stars: 2, title: "Old", name: "Bo", text: "Was fine" }, onSend: async (d) => sent.push(d) });
  assert.deepEqual([e.stars.value(), e.fields.title.input.value, e.fields.name.input.value, e.fields.text.input.value], [2, "Old", "Bo", "Was fine"]);
  await byText(e.sheet, "Cancel").click();
  assert.equal(e.closed(), true);
  assert.equal(sent.length, 1, "Cancel sends nothing");
});

function fakeApi(pages, { enabled = true } = {}) {
  const log = [];
  return {
    log,
    async list(id, page = 0) { log.push(["list", id, page]); return enabled ? pages[page] : { enabled: false, count: 0, reviews: [], histogram: [0, 0, 0, 0, 0] }; },
    async post(id, d) { log.push(["post", id, d]); return { ok: true, review: { id: "me00000000000000", ...d } }; },
    async report(id, rid) { log.push(["report", id, rid]); return { ok: true, hidden: false }; },
  };
}
const now = Date.UTC(2026, 10, 18);
const rv = (id, title, extra = {}) => ({ id, stars: 4, title, name: "N", text: `${title} text`, version: "1.0", date: now - 86400000, updated: now - 86400000, ...extra });

test("the Reviews tab: ours and the depiction's in one list, Tap to Rate keeps your words, Report on others' only", async () => {
  const mine = rv("me00000000000000", "Mine", { text: "My words" });
  const api = fakeApi([{ enabled: true, average: 4.5, count: 2, histogram: [1, 1, 0, 0, 0], more: true,
    reviews: [rv("aa00000000000000", "Theirs <img src=x onerror=alert(1)>"), mine], mine: { ...mine, hidden: false } },
  { enabled: true, average: 4.5, count: 2, histogram: [1, 1, 0, 0, 0], more: false, reviews: [rv("bb00000000000000", "Older")], mine: null }]);
  const depiction = { average: 3, count: 1, noun: "Reviews", reviews: [{ title: "From the depiction", author: "dev", rating: 3, text: "**md**" }] };
  const pane = document.createElement("div");
  let confirmed = 0, sheets = [];
  const rated = [];
  await reviewsTab(pane, { id: "com.example.velvet", version: "2.0", depiction, api, now, renderText: (x) => Object.assign(document.createElement("div"), { _text: `md:${x.text}` }),
    confirm: async () => { confirmed++; return true; }, sheet: (o) => sheets.push(o), onRating: (r) => rated.push(r), rateDelay: 0 });
  const titles = () => find(pane, "store-review-title").map((t) => t.textContent);
  assert.deepEqual(titles(), ["1. Theirs <img src=x onerror=alert(1)>", "2. Mine", "3. From the depiction"]);
  assert.ok(all(pane).every((x) => x.tagName !== "IMG"), "a review's text is text, never markup");
  assert.equal(find(pane, "store-review-text")[0].textContent, "Theirs <img src=x onerror=alert(1)> text");
  assert.equal(all(pane).some((x) => x.textContent === "md:**md**"), true, "the depiction's go through renderText");
  assert.equal(find(pane, "review-report").length, 1, "Report on someone else's review written here, not yours or the depiction's");
  assert.match(find(pane, "store-review-by")[0].textContent, /^by N – Version 1\.0 – Nov 1[67]$/);
  assert.equal(one(pane, "store-ratings-from").textContent, "2 from users here, 1 in the depiction. Bars from 3 reviews.");
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
  assert.equal(byText(pane, "Edit Your Review").textContent, "Edit Your Review");
  assert.equal(api.log.filter((l) => l[0] === "list").length, 1);

  // Report: asks, then sends, then says so
  await one(pane, "review-report").click();
  assert.equal(confirmed, 1);
  assert.deepEqual(api.log.at(-1), ["report", "com.example.velvet", "aa00000000000000"]);
  assert.equal(one(pane, "review-reported").textContent, "Reported. Thank you.");

  // More Reviews: page 1 goes after ours, before the depiction's
  await byText(pane, "More Reviews…").click();
  assert.deepEqual(titles(), ["1. Theirs <img src=x onerror=alert(1)>", "2. Mine", "3. Older", "4. From the depiction"]);
  assert.equal(byText(pane, "More Reviews…"), undefined, "no more pages");

  // Write a Review opens the sheet with your review in it
  await byText(pane, "Edit Your Review").click();
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].initial.text, "My words");
  assert.equal(sheets[0].version, "2.0");

  // Tap to Rate: only the stars change; the tab draws again and the header follows
  const picker = one(pane, "review-stars");
  await picker.children[1].click();
  await tick();
  const post = api.log.find((l) => l[0] === "post");
  assert.deepEqual(post[2], { stars: 2, title: "Mine", name: "N", text: "My words", version: "2.0" });
  assert.equal(api.log.filter((l) => l[0] === "list").length, 3, "listed again after the post");
  assert.equal(rated.length >= 1, true);
});

test("a server without reviews: no Tap to Rate or Write a Review, the others' ratings as before", async () => {
  const pane = document.createElement("div");
  const api = fakeApi([], { enabled: false });
  await reviewsTab(pane, { id: "com.example.tweak", api, depiction: Promise.resolve({ average: 4.2, count: 1200, noun: "Ratings", reviews: [] }), now });
  assert.equal(one(pane, "review-tap"), undefined);
  assert.equal(byText(pane, "Write a Review"), undefined);
  assert.equal(one(pane, "store-ratings-big").textContent, "4.2");
  assert.equal(one(pane, "store-reviews-footer").textContent, "Ratings and reviews from the package's depiction.");
  assert.equal(one(pane, "store-review-toggle"), undefined, "a tweak page has no This Build / App Store toggle");

  const fresh = document.createElement("div");
  const api2 = fakeApi([{ enabled: true, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], more: false, mine: null }]);
  const sheets = [];
  await reviewsTab(fresh, { id: "com.example.new", api: api2, now, sheet: (o) => sheets.push(o) });
  assert.equal(one(fresh, "store-ratings-count").textContent, "No Ratings");
  assert.equal(find(fresh, "store-bar").length, 5, "F206: no ratings still draws the five bars, so nothing moves");
  assert.equal(one(fresh, "review-tap-label").textContent, "Tap to Rate:");
  await byText(fresh, "Write a Review").click();
  assert.equal(sheets[0].initial, null);
});

test("rated by Tap to Rate alone: the card counts it and the list says nothing is written", async () => {
  const pane = document.createElement("div");
  const api = fakeApi([{ enabled: true, average: 1, count: 1, histogram: [0, 0, 0, 0, 1], reviews: [], more: false, mine: null }]);
  await reviewsTab(pane, { id: "com.example.clip", api, build: true, now });
  assert.equal(one(pane, "store-reviews-none").textContent, "No written reviews yet.");
  const fresh = document.createElement("div");
  const api2 = fakeApi([{ enabled: true, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], more: false, mine: null }]);
  await reviewsTab(fresh, { id: "com.example.new", api: api2, build: true, now });
  assert.equal(one(fresh, "store-reviews-none"), undefined, "no ratings: the card's No Ratings says it");
});

// B82: an app page's App Store side: Apple's rating, its name and seller, and its written reviews asked for lazily.
const storeSide = (reviews, extra = {}) => {
  const asked = { n: 0 };
  return { asked, store: { average: 2.1, count: 50123456, noun: "Ratings", name: "YouTube", seller: "Google LLC",
    reviews: async () => { asked.n++; return reviews; }, ...extra } };
};
const appleReview = (i, rating = 1) => ({ appStore: true, title: `Apple ${i}`, author: "Someone", rating, version: "19.0", at: Date.UTC(2026, 10, 17, 12) - i, text: "<b>not markup</b>" });

test("B82: app page, rated here: This Build | App Store toggle, opening on ours alone; Apple's 50M never moves it", async () => {
  const pane = document.createElement("div");
  const mine = rv("me00000000000000", "Mine", { stars: 5 });
  const api = fakeApi([{ enabled: true, average: 4.5, count: 12, histogram: [8, 3, 1, 0, 0], more: false,
    reviews: [mine, rv("aa00000000000000", "Theirs", { stars: 4 })], mine }]);
  const { store, asked } = storeSide(Array.from({ length: 13 }, (_, i) => appleReview(i + 1)));
  const rated = [];
  const tab = await reviewsTab(pane, { id: "com.google.ios.youtube", api, build: true, appStore: Promise.resolve(store), now, onRating: (r) => rated.push(r) });
  const seg = one(pane, "store-review-toggle");
  assert.ok(seg, "a toggle when the App Store has the app");
  assert.deepEqual(find(seg, "store-segment").map((b) => b.textContent), ["This Build (12)", "App Store (50M)"]);
  assert.equal(tab.toggle.selected(), "build", "always opens on This Build");
  assert.equal(tab.toggle.buttons[0]._cls.has("selected"), true);
  const [buildView, storeView] = tab.toggle.views;
  assert.equal([buildView.hidden, storeView.hidden].join(), "false,true");
  assert.equal(asked.n, 0, "Apple's written reviews not asked for before the App Store view opens");
  const card = one(buildView, "store-ratings-group");
  assert.equal(one(card, "group-header"), undefined, "the This Build card has no group header");
  assert.equal(one(card, "store-ratings-big").textContent, "4.5", "ours alone");
  assert.equal(one(card, "store-ratings-count").textContent, "12 Ratings");
  assert.deepEqual(find(card, "store-bar-n").map((n) => n.textContent), ["8", "3", "1", "0", "0"], "the bars are ours");
  assert.equal(one(card, "store-ratings-from").textContent, "Rated by people using this build. Bars from 12 ratings.");
  assert.ok(byText(buildView, "Edit Your Review") || byText(buildView, "Write a Review"));
  assert.equal(one(buildView, "store-reviews-footer"), undefined, "rated here: no footer");
  assert.deepEqual(rated[0], { average: 4.5, count: 12, noun: "Ratings", histogram: [8, 3, 1, 0, 0] }, "the header and tile get ours");

  await tab.toggle.buttons[1].click();
  assert.equal(tab.toggle.selected(), "appstore");
  assert.equal([buildView.hidden, storeView.hidden].join(), "true,false");
  const sc = one(storeView, "store-appstore");
  assert.equal(one(sc, "store-appstore-big").textContent, "2.1");
  assert.equal(one(sc, "store-appstore-count").textContent, "50,123,456 Ratings");
  assert.equal(find(sc, "store-bar").length, 0, "no bars: Apple gives no histogram");
  assert.equal(one(sc, "store-appstore-note").textContent, "For YouTube by Google LLC on the App Store, not this build.");
  await tab.toggle.loaded();
  assert.equal(asked.n, 1);
  const g = one(storeView, "store-reviews-appstore");
  assert.equal(one(g, "group-header").textContent, "Reviews");
  assert.equal(find(g, "store-review").length, 10, "ten at a time");
  assert.equal(one(g, "store-review-title").textContent, "1. Apple 1");
  assert.equal(one(g, "store-review-by").textContent, "by Someone – Version 19.0 – Nov 17");
  assert.equal(one(g, "store-review-text").textContent, "<b>not markup</b>", "drawn as text, never markup");
  assert.equal(one(g, "review-report"), undefined, "no Report on Apple's");
  await byText(storeView, "More Reviews…").click();
  assert.equal(find(g, "store-review").length, 13);
  assert.equal(byText(storeView, "More Reviews…"), undefined, "none left: the button goes");

  // the star filter and the bars ignore Apple's (all 1-star here)
  await tab.toggle.buttons[0].click();
  assert.equal(tab.toggle.selected(), "build");
  assert.equal(storeView.hidden, true);
  tab.setFilter(1);
  assert.equal(one(one(buildView, "store-reviews-filtered"), "group-header").textContent, "1-Star Reviews (0)");
  await tab.toggle.buttons[1].click();
  assert.equal(asked.n, 1, "asked once");
});

test("B82: app page, nobody rated here: the empty This Build card, the footer, and the page falls back to Apple's", async () => {
  const pane = document.createElement("div");
  const api = fakeApi([{ enabled: true, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], more: false, mine: null }]);
  const { store } = storeSide([]);
  const rated = [];
  const tab = await reviewsTab(pane, { id: "com.google.ios.youtube", api, build: true, appStore: store, now, onRating: (r) => rated.push(r) });
  assert.deepEqual(find(pane, "store-segment").map((b) => b.textContent), ["This Build", "App Store (50M)"]);
  const card = one(pane, "store-ratings-group");
  assert.equal(one(card, "store-ratings-big").textContent, "—", "never Apple's average on the This Build card");
  assert.equal(find(card, "store-bar").length, 5, "the empty bars stay");
  assert.equal(one(card, "store-ratings-from").textContent, "Nobody has rated this build yet. Be the first.");
  assert.equal(one(pane, "review-tap-label").textContent, "Tap to Rate:");
  assert.equal(one(pane, "store-reviews-footer").textContent, "Ratings here are for this build only. The App Store tab has the original app's.");
  assert.deepEqual(rated[0], { average: 2.1, count: 50123456, noun: "Ratings", onAppStore: true });
  await tab.toggle.buttons[1].click();
  await tab.toggle.loaded();
  assert.equal(one(tab.toggle.views[1], "store-reviews-none").textContent, "No App Store reviews to show.");
  assert.equal(byText(pane, "More Reviews…"), undefined);
});

test("B82: app page without an App Store match: no toggle, just This Build", async () => {
  const pane = document.createElement("div");
  const api = fakeApi([{ enabled: true, average: 3, count: 1, histogram: [0, 0, 1, 0, 0], reviews: [], more: false, mine: null }]);
  const tab = await reviewsTab(pane, { id: "com.example.homebrew", api, build: true, appStore: Promise.resolve(null), now });
  assert.equal(tab.toggle, null);
  assert.equal(one(pane, "store-review-toggle"), undefined);
  assert.equal(one(pane, "store-appstore"), undefined);
  assert.equal(one(pane, "store-ratings-from").textContent, "Rated by people using this build. Bars from 1 rating.");
  assert.equal(one(pane, "store-reviews-footer"), undefined, "no footer pointing at an App Store tab that isn't there");
});

test("B82: Tap to Rate redraws the tab on This Build and Apple's reviews are still asked only once", async () => {
  const pane = document.createElement("div");
  const empty = { enabled: true, average: null, count: 0, histogram: [0, 0, 0, 0, 0], reviews: [], more: false, mine: null };
  const after = { enabled: true, average: 4, count: 1, histogram: [0, 1, 0, 0, 0], reviews: [], more: false, mine: { id: "me00000000000000", stars: 4 } };
  let calls = 0;
  const api = { ...fakeApi([]), list: async () => (calls++ ? after : empty), post: async (id, d) => ({ ok: true, review: { id: "me00000000000000", ...d } }) };
  const { store, asked } = storeSide([appleReview(1)]);
  const rated = [];
  const tab = await reviewsTab(pane, { id: "x", api, build: true, appStore: store, now, onRating: (r) => rated.push(r), rateDelay: 0 });
  await tab.toggle.buttons[1].click();
  await tab.toggle.loaded();
  await tab.toggle.buttons[0].click();
  await tab.rating.picker.buttons[3].click();
  await tab.rating.flush();
  assert.deepEqual(find(pane, "store-segment").map((b) => b.textContent), ["This Build (1)", "App Store (50M)"]);
  assert.equal(one(pane, "store-ratings-big").textContent, "4.0");
  assert.deepEqual(rated.at(-1), { average: 4, count: 1, noun: "Ratings", histogram: [0, 1, 0, 0, 0] }, "the header follows: ours now");
  const views = find(pane, "store-review-view");
  await byText(pane, "App Store (50M)").click();
  assert.equal(views[1].hidden, false);
  assert.equal(asked.n, 1, "the redraw kept Apple's reviews");
});

test("F206: the bars count the reviews we have (no histogram), a row filters the list, again or Show All clears it", async () => {
  const pane = document.createElement("div");
  const api = fakeApi([], { enabled: false });
  const depiction = { average: 4, count: 3, noun: "Reviews", reviews: [
    { title: "Four A", author: "a", rating: 4, text: "x" }, { title: "Five", author: "b", rating: 5, text: "x" },
    { title: "Four B", author: "c", rating: 4, text: "x" }] };
  const tab = await reviewsTab(pane, { id: "x", api, depiction, now });
  const rows = find(pane, "store-bar");
  assert.deepEqual(rows.map((r) => r.dataset.stars), ["5", "4", "3", "2", "1"]);
  assert.deepEqual(rows.map((r) => one(r, "store-bar-n").textContent), ["1", "2", "0", "0", "0"], "the depiction's counted");
  assert.equal(rows.every((r) => r.tagName === "BUTTON" && !r.disabled), true, "each row a real button");
  assert.equal(one(rows[1], "store-bar-fill").style.transform, "scaleX(1)", "scaled, not resized (120 Hz)");
  assert.equal(find(rows[1], "store-bar-star").filter((s) => s._cls.has("on")).length, 4, "the rating's stars dark");
  assert.ok(one(rows[1], "store-bar-chevron"));
  assert.match(one(pane, "store-ratings-from").textContent, /Bars from 3 reviews\.$/);
  assert.equal(one(pane, "store-ratings-hint").textContent, "Tap a row to see only those reviews.");

  await rows[1].click(); // 4 stars
  assert.equal(tab.filter(), 4);
  assert.equal(rows[1]._cls.has("selected"), true);
  assert.equal(rows[1].attrs["aria-pressed"], "true");
  assert.equal(rows.filter((r) => r._cls.has("selected")).length, 1);
  const g = one(pane, "store-reviews-filtered");
  assert.equal(one(g, "group-header").textContent, "4-Star Reviews (2)");
  assert.deepEqual(find(g, "store-review-title").map((t) => t.textContent), ["1. Four A", "2. Four B"]);
  assert.equal(one(pane, "store-ratings-hint").textContent, "Showing 4-star reviews. Tap the row again for all.");
  assert.ok(byText(pane, "Show All 3 Reviews"));

  await rows[1].click(); // the same row again: all
  assert.equal(tab.filter(), null);
  assert.equal(rows[1]._cls.has("selected"), false);
  assert.equal(one(pane, "store-reviews-filtered"), undefined);
  assert.equal(find(pane, "store-review-title").length, 3);
  assert.equal(one(pane, "store-ratings-hint").textContent, "Tap a row to see only those reviews.");

  await rows[2].click(); // 3 stars: none
  assert.equal(one(one(pane, "store-reviews-filtered"), "group-header").textContent, "3-Star Reviews (0)");
  assert.equal(one(pane, "store-reviews-none").textContent, "No reviews with this rating.");
  await rows[4].click(); // another row switches straight to it
  assert.equal(one(one(pane, "store-reviews-filtered"), "group-header").textContent, "1-Star Reviews (0)");
  await byText(pane, "Show All 3 Reviews").click();
  assert.equal(tab.filter(), null);
  assert.equal(rows.some((r) => r._cls.has("selected")), false);
  assert.equal(byText(pane, "Show All 3 Reviews"), undefined);
});

test("F206: the card's skeleton while the reviews load has the filled card's shape; no ratings keeps the card", async () => {
  const pane = document.createElement("div");
  let answer;
  const api = { list: () => new Promise((r) => { answer = r; }) };
  const done = reviewsTab(pane, { id: "x", api, now });
  const shape = (n) => all(n).filter((x) => x._cls?.size).map((x) => [...x._cls].filter((c) => c !== "selected").join("."));
  const skeleton = one(pane, "store-ratings-group");
  assert.ok(skeleton, "the card from the start, not a spinner");
  assert.equal(one(pane, "loading-spinner"), undefined);
  assert.equal(one(skeleton, "store-ratings").dataset.pending, "true");
  assert.equal(find(skeleton, "store-bar").length, 5);
  assert.equal(find(skeleton, "store-bar").every((r) => r.disabled), true, "nothing to filter yet");
  assert.equal(one(skeleton, "store-ratings-big").textContent, "—");
  answer({ enabled: false, count: 0, reviews: [] });
  await done;
  const filled = one(pane, "store-ratings-group");
  assert.notEqual(filled, skeleton);
  const cardShape = (g) => shape(one(g, "store-ratings"));
  assert.deepEqual(cardShape(filled), cardShape(skeleton), "the same rows and parts, so the same height");
  assert.equal(one(filled, "store-ratings-count").textContent, "No Ratings");
  assert.equal(one(filled, "store-ratings-from").textContent, "No reviews to count yet.");
});

test("F207: Delete Review only with a review of yours: in the sheet and on your row, asked first, then the tab redraws", async () => {
  // the sheet: no button for a new review; with one, it asks, deletes and closes
  document.body.replaceChildren();
  let asked = 0, ok = false, deleted = 0;
  const none = writeReviewSheet({ initial: null, onDelete: async () => { deleted++; }, confirmDelete: async () => { asked++; return ok; } });
  assert.equal(byText(none.sheet, "Delete Review"), undefined, "nothing to delete yet");
  none.close();
  const s = writeReviewSheet({ initial: { stars: 4, title: "Mine" }, onDelete: async () => { deleted++; }, confirmDelete: async () => { asked++; return ok; } });
  const red = byText(s.sheet, "Delete Review");
  assert.ok(red && red._cls.has("action-button") && red._cls.has("destructive"), "iOS 6's red destructive button");
  await red.click();
  assert.deepEqual([asked, deleted, s.closed()], [1, 0, false], "Cancel in the action sheet deletes nothing");
  ok = true;
  await red.click();
  assert.deepEqual([asked, deleted, s.closed()], [2, 1, true]);
  const failing = writeReviewSheet({ initial: { stars: 4 }, onDelete: async () => { throw new Error("Too many changes from here."); }, confirmDelete: async () => true });
  await failing.remove();
  assert.deepEqual([failing.closed(), failing.error.textContent], [false, "Too many changes from here."]);
  failing.close();

  // the tab: your row gets Delete Review (no Report); deleting lists again with no `mine`, so Tap to Rate is empty
  const mine = rv("me00000000000000", "Mine", { stars: 5 });
  const pages = [{ enabled: true, average: 4.5, count: 2, histogram: [1, 1, 0, 0, 0], more: false, reviews: [rv("aa00000000000000", "Theirs"), mine], mine: { ...mine, hidden: false } }];
  const base = fakeApi(pages);
  const api = { ...base, async remove(id, rid) { base.log.push(["remove", id, rid]); pages[0] = { enabled: true, average: 4, count: 1, histogram: [0, 1, 0, 0, 0], more: false, reviews: [rv("aa00000000000000", "Theirs")], mine: null }; return { ok: true, id: rid }; } };
  const pane = document.createElement("div");
  const sheets = [], rated = [];
  let answer = false;
  await reviewsTab(pane, { id: "com.example.velvet", api, now, sheet: (o) => sheets.push(o), confirmDelete: async () => answer, onRating: (r) => rated.push(r) });
  assert.equal(find(pane, "review-delete-own").length, 1, "only on your own row");
  assert.equal(find(pane, "review-report").length, 1, "Report stays on the other one");
  assert.equal(one(pane, "review-tap-label").textContent, "Your Rating:");
  await byText(pane, "Edit Your Review").click();
  assert.equal(typeof sheets[0].onDelete, "function", "the sheet gets Delete Review");
  await one(pane, "review-delete-own").click();
  assert.equal(base.log.some((l) => l[0] === "remove"), false, "Cancel: nothing deleted");
  answer = true;
  await one(pane, "review-delete-own").click();
  await tick();
  assert.deepEqual(base.log.find((l) => l[0] === "remove"), ["remove", "com.example.velvet", "me00000000000000"]);
  assert.equal(one(pane, "review-tap-label").textContent, "Tap to Rate:");
  assert.equal(find(one(pane, "review-tap"), "on").length, 0, "no stars lit");
  assert.equal(find(pane, "review-delete-own").length, 0);
  assert.deepEqual(find(pane, "store-review-title").map((t) => t.textContent), ["1. Theirs"]);
  assert.equal(rated.at(-1).count, 1, "the header's count follows");
  assert.equal(byText(pane, "Write a Review").textContent, "Write a Review");
  await byText(pane, "Write a Review").click();
  assert.equal(sheets.at(-1).onDelete, null, "no review: no Delete Review in the sheet");
});
