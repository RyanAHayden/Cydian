// R30: sign an IPA exactly as the website does (websign-job.js + the vendor/zsign WebAssembly), so a free Apple ID's
// development certificate and 7-day profile can be put through /sign/upload and the iOS install prompt.
// Usage: node websign.mjs REPO IN.ipa KEY.p12 PASSWORD PROFILE.mobileprovision OUT.ipa [keep|change]
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [repo, ipa, p12, password, profile, out, mode = "keep"] = process.argv.slice(2);
const { runSignJob } = await import(pathToFileURL(`${repo}/web/app/websign-job.js`));
const { default: createZsign } = await import(pathToFileURL(`${repo}/web/app/vendor/zsign/zsign.js`));
const rd = (p) => new Uint8Array(readFileSync(p));
const r = await runSignJob(createZsign, { ipa: rd(ipa), p12: rd(p12), password, profile: rd(profile),
  keepBundleId: mode === "keep" }, { progress: (m) => console.error(String(m?.text ?? m)) });
writeFileSync(out, r.ipa);
console.log(JSON.stringify({ bundleId: r.bundleId, originalId: r.originalId, name: r.name, version: r.version, bytes: r.ipa.length }));
