// R45: iFizBox's own payment client (core/payment.js) against the live Chariz Sileo endpoint for betterAlarm (FREE),
// signed out, and paidTweakDeb's verdict; then the same authorize_download with no token, to see what Chariz does.
// Run from the repo root: node journal/2026-11-20-r45-paid-sideload-check/chariz.mjs
// SPDX-License-Identifier: GPL-3.0-or-later
import { join } from "node:path";
const { createPaymentClient, paidTweakDeb, PaidNeeded } = await import(join(process.cwd(), "web/app/core/payment.js"));

const request = async ({ method, url, headers, body }) => {
  const r = await fetch(url, { method, headers, body: body ?? undefined });
  let json = null;
  try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, json };
};
const creds = { load: async () => null, forget: async () => {} };
const device = () => ({ udid: "00008030-001A2B3C4D5E6F70", model: "iPhone14,2" });
const client = createPaymentClient({ base: "https://chariz.com/api/sileo/", request, device, credentials: creds });
const ID = "com.noisyflake.betteralarm";
console.log("info:", JSON.stringify(await client.info()));
console.log("packageInfo:", JSON.stringify(await client.packageInfo(ID)));
const st = { package: ID, version: "1.4.1", architecture: "iphoneos-arm64" };
try {
  await paidTweakDeb(st, { client, repo: "https://repo.chariz.com/", download: async (u) => u });
  console.log("paidTweakDeb: downloaded");
} catch (e) {
  console.log("paidTweakDeb:", e instanceof PaidNeeded ? `PaidNeeded(${e.need}, ${e.price})` : String(e));
}
try {
  const url = await client.authorizeDownload(ID, { version: "1.4.1", repo: "https://repo.chariz.com/", architecture: "iphoneos-arm64" });
  console.log("authorizeDownload with no token:", url.replace(/\?.*/, "?…"));
} catch (e) { console.log("authorizeDownload with no token:", String(e)); }
