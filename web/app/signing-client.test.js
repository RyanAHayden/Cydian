import { test } from "node:test";
import assert from "node:assert/strict";

test("website signing: a dropped upload part is sent again; a server answer is final", async () => {
  const { uploadSigned } = await import("./signing-client.js");
  let drops = 1;
  const seen = [];
  const fetcher = async (u, o) => {
    seen.push(`${o.method} ${u.split("?")[0]}`);
    if (u.endsWith("/sign/upload/t/1") && drops-- > 0) throw new TypeError("Load failed");
    if (u.includes("/sign/upload?")) return { ok: true, json: async () => ({ token: "t", parts: 2, partSize: 2 }) };
    return { ok: true, json: async () => ({ itms: "itms-services://x" }) };
  };
  const r = await uploadSigned(new Uint8Array([1, 2, 3, 4]), { bundleId: "a.b", name: "A", version: "1" }, { fetcher, wait: async () => {} });
  assert.equal(r.itms, "itms-services://x");
  assert.deepEqual(seen, ["POST /sign/upload", "PUT /sign/upload/t/0", "PUT /sign/upload/t/1", "PUT /sign/upload/t/1", "POST /sign/upload/t/done"]);
});
