// F93: the website's signer, a module Web Worker (signing-client.js signInBrowser starts one per Install): zsign as
// WebAssembly (vendor/zsign) signs the IPA in this worker's memory. In: { ipa, p12, password, profile, bring }
// (ArrayBuffers, transferred). Out: { progress } while it works, then { ok: true, ipa, bundleId, name, version } or
// { ok: false, error, code }.
// SPDX-License-Identifier: GPL-3.0-or-later
import { runSignJob } from "./websign-job.js";

self.onmessage = async (e) => {
  try {
    const { default: createZsign } = await import("./vendor/zsign/zsign.js");
    const r = await runSignJob(createZsign, e.data, { progress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ ok: true, ...r }, [r.ipa.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.message ?? err), code: err?.code ?? "sign_failed" });
  }
};
