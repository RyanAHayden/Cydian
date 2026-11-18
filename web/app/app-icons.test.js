// app-icons.js iconUrl: where each share-sheet app's icon comes from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { iconUrl, APP_ICONS } from "./app-icons.js";

test("an app's icon: its bundle's iconURL in its own source, else the source's, else the fixed URL", async () => {
  const src = JSON.stringify({ iconURL: "https://s.test/source.png", apps: [
    { bundleIdentifier: "other", iconURL: "https://s.test/other.png" },
    { bundleIdentifier: "com.SideStore.SideStore", iconURL: "https://s.test/sidestore.png" }] });
  assert.equal(await iconUrl(APP_ICONS.SideStore, async () => src), "https://s.test/sidestore.png");
  assert.equal(await iconUrl({ source: "x", bundle: "missing" }, async () => src), "https://s.test/source.png");
  assert.equal(await iconUrl({ source: "x", bundle: "a" }, async () => JSON.stringify({ apps: [{ bundleIdentifier: "a", iconURL: "http://plain.test/i.png" }] })), null);
  assert.equal(await iconUrl(APP_ICONS.Sileo), "https://github.com/Sileo.png?size=120");
  assert.equal(await iconUrl(undefined), null);
  assert.equal(APP_ICONS.Cydia, undefined, "Cydia keeps its letter: its logo is never used");
});
