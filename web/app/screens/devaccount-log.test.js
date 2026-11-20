// The website's sign log (autoProfileSite's `log`) shows what core/asc.js ensureProfile logs, like the app's: a
// capability Apple refuses is logged once and remembered per team in the site's profile cache, then skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoProfileSite } from "./devaccount.js";
import { toBase64 } from "../core/signing.js";

const PROFILE = new Uint8Array(readFileSync(new URL("../core/fixtures/signing/test.mobileprovision", import.meta.url)));

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// App Store Connect with one capability it refuses for every App ID.
function fakeAsc(refuse) {
  const s = { bundleIds: [], caps: {}, n: 0, asked: [] };
  s.request = async (method, path, body) => {
    const p = path.split("?")[0];
    if (method === "GET" && p === "/certificates") return { data: [{ id: "C1", attributes: { certificateType: "DISTRIBUTION", serialNumber: "01" } }] };
    if (method === "GET" && p === "/devices") return { data: [] };
    if (method === "GET" && p === "/bundleIds") return { data: s.bundleIds };
    if (method === "POST" && p === "/bundleIds") { const b = { id: `b${++s.n}`, attributes: body.data.attributes }; s.bundleIds.push(b); s.caps[b.id] = []; return { data: b }; }
    if (method === "POST" && p === "/bundleIdCapabilities") {
      const cap = body.data.attributes.capabilityType;
      s.asked.push(cap);
      if (cap === refuse) throw Object.assign(new Error("not allowed for this team"), { status: 409 });
      s.caps[body.data.relationships.bundleId.data.id].push(cap);
      return { data: {} };
    }
    let m = /^\/bundleIds\/([^/]+)\/bundleIdCapabilities$/.exec(p);
    if (method === "GET" && m) return { data: s.caps[m[1]].map((c) => ({ attributes: { capabilityType: c } })) };
    m = /^\/bundleIds\/([^/]+)$/.exec(p);
    if (method === "GET" && m) return { data: s.bundleIds.find((b) => b.id === m[1]) ?? null };
    if (method === "GET" && p === "/profiles") return { data: [] };
    if (method === "POST" && p === "/profiles") return { data: { id: `p${++s.n}`, attributes: { name: body.data.attributes.name, profileContent: toBase64(PROFILE) } } };
    if (method === "DELETE") return {};
    throw new Error(`fake ASC: no route ${method} ${path}`);
  };
  return s;
}

test("autoProfileSite: a capability Apple refuses shows in the website's sign log once, then is skipped", async (t) => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true, writable: true });
  t.after(() => { if (had) Object.defineProperty(globalThis, "localStorage", had); else delete globalThis.localStorage; });
  globalThis.localStorage.setItem("ifizbox.asc", JSON.stringify({ p8: "x", keyId: "K", issuerId: "I" }));

  const asc = fakeAsc("ICLOUD");
  const id = { p12: Uint8Array.of(1), profile: PROFILE };
  const cert = async () => ({ serial: "01", team: "T" });
  const lines = [];
  const made = await autoProfileSite({ ipa: null, id, bundleId: "com.example.app", log: (l) => lines.push(l), cert, request: asc.request });
  assert.ok(made instanceof Uint8Array);
  const refused = lines.filter((l) => l.startsWith("Capability ICLOUD: Apple refused it"));
  assert.equal(refused.length, 1, lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("Profile ")), lines.join("\n"));
  assert.equal(asc.asked.filter((c) => c === "ICLOUD").length, 1);

  // a second app on the same team: not asked again, nothing logged about it
  const again = [];
  await autoProfileSite({ ipa: null, id, bundleId: "com.example.other", log: (l) => again.push(l), cert, request: asc.request });
  assert.equal(asc.asked.filter((c) => c === "ICLOUD").length, 1);
  assert.ok(!again.some((l) => l.includes("ICLOUD")), again.join("\n"));
});
