// B82: the app page's Reviews tab gets the App Store apart from this build (screens/altstore.js appStoreTab): Apple's
// rating, the app's App Store name and seller, and its written reviews only when asked (the App Store view opening);
// null when the App Store doesn't have the app (no toggle). The header stars and Rating tile use core/reviews.js
// pageRating: ours when rated here, never averaged with a 50M App Store count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appStoreTab } from "./altstore.js";
import { parseLookup, clearStoreReviewsMemory } from "../core/applookup.js";
import { pageRating } from "../core/reviews.js";

const feed = JSON.stringify({ feed: { entry: [{ "im:rating": { label: "2" }, title: { label: "Ads" }, content: { label: "Too many." },
  updated: { label: "2026-11-17T05:34:34-07:00" } }] } });

test("B82: appStoreTab: rating, name and seller at once; Apple's written reviews only when the view asks", async () => {
  clearStoreReviewsMemory();
  const asked = [];
  const backend = { kind: "http" };
  const fetchFn = async (u) => { asked.push(u); return { ok: true, text: async () => feed }; };
  const looked = Promise.resolve(parseLookup({ results: [{ trackId: 544007664, trackName: "YouTube", artistName: "Google LLC",
    trackViewUrl: "https://apps.apple.com/us/app/youtube/id544007664", averageUserRating: 4.6, userRatingCount: 50123456 }] }));
  const s = await appStoreTab(Promise.resolve({ average: 4.6, count: 50123456, noun: "Ratings" }), looked, { backend, fetchFn, locale: "en-US" });
  assert.deepEqual([s.average, s.count, s.name, s.seller], [4.6, 50123456, "YouTube", "Google LLC"]);
  assert.deepEqual(asked, [], "nothing fetched before the App Store view opens");
  assert.deepEqual((await s.reviews()).map((r) => r.title), ["Ads"]);
  assert.deepEqual(asked, ["/api/appreviews?id=544007664&country=us"]);
});

test("B82: appStoreTab: no App Store match is null (no toggle); a match without a rating still gets the view", async () => {
  assert.equal(await appStoreTab(Promise.resolve(null), Promise.resolve(null)), null);
  assert.equal(await appStoreTab(Promise.reject(new Error("x")), Promise.reject(new Error("y"))), null);
  const looked = Promise.resolve(parseLookup({ results: [{ trackId: 1, trackName: "Tiny", sellerName: "Me", trackViewUrl: "https://apps.apple.com/us/app/t/id1" }] }));
  const s = await appStoreTab(Promise.resolve(null), looked);
  assert.deepEqual([s.average, s.name, s.seller], [undefined, "Tiny", "Me"]);
});

test("B82: the page's stars: a 50M App Store count never moves ours; with none here, Apple's, marked", () => {
  const store = { average: 2.1, count: 50123456, noun: "Ratings" };
  assert.deepEqual(pageRating({ ours: { enabled: true, average: 4.8, count: 3, histogram: [3, 0, 0, 0, 0] }, appStore: store }),
    { average: 4.8, count: 3, noun: "Ratings", histogram: [3, 0, 0, 0, 0] });
  assert.equal(pageRating({ ours: { enabled: true, average: null, count: 0 }, appStore: store }).onAppStore, true);
});
