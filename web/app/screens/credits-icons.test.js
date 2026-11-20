// Every Credits row shows its project's picture (icon.src), with the letter kept as the fallback.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window ??= { open() {} };
const { softwareSections } = await import("./home.js");

test("every Credits > Software row has a picture and a letter fallback", () => {
  const rows = softwareSections().flatMap((g) => g.rows);
  assert.deepEqual(rows.map((r) => r.label), ["ElleKit", "Canister", "zsign", "OpenSSL", "zlib", "idevice", "Tailscale"]);
  for (const r of rows) {
    assert.match(r.icon.src || "", /^https:\/\//, r.label);
    assert.equal(r.icon.text, r.label.charAt(0).toUpperCase(), r.label);
  }
});
