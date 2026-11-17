// F39: the server-mode subscription carries AltStore source URLs (for their news) apart from the APT sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribeBody } from "./push-client.js";

test("subscribeBody splits AltStore sources off as altSources; device mode sends none", () => {
  const sources = [
    { key: "deb:https://r/:./", uri: "https://r/", dist: "./", components: [] },
    { key: "alt:https://alt.example/a.json", kind: "altstore", uri: "https://alt.example/a.json", name: "Alt" },
  ];
  const b = subscribeBody({ sources, installed: [], arch: "iphoneos-arm64" });
  assert.deepEqual(b.sources, [{ uri: "https://r/", dist: "./", components: [] }]);
  assert.deepEqual(b.altSources, ["https://alt.example/a.json"]);
  assert.equal("altSources" in subscribeBody({ sources: sources.slice(0, 1), arch: "iphoneos-arm64" }), false);
  assert.equal("altSources" in subscribeBody({ sources, mode: "device", arch: "iphoneos-arm64" }), false);
});
