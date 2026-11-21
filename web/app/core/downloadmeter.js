// B262: an IPA download's progress for the Log and the run page's row, as the shell's DownloadMeter
// (native/sign/DownloadMeter.swift) words it, for the website's fetch (signing/browser.js) and the row's MB/s.
//
//   createDownloadMeter({ every = 1000, now = Date.now }) -> { add(bytes, total) -> tick | null }
//       at most one tick every `every` ms (the first call only starts the clock): { bytes, total, rate } with rate in
//       bytes a second over the last interval; bytes going backwards (a download started again) start the count again
//   downloadLine(tick) -> "Downloaded 120.3 of 312.0 MB (38%), 21.4 MB/s" (no total: "Downloaded 120.3 MB, 21.4 MB/s")
//   rateText(rate)     -> "21.4 MB/s"
// SPDX-License-Identifier: GPL-3.0-or-later

import { rateText } from "./signing.js"; // already loaded at startup (this module isn't: module-graph.test.js)
export { rateText };

const mb = (n) => (Number(n) / 1048576).toFixed(1);

export function downloadLine({ bytes = 0, total = 0, rate = 0 } = {}) {
  if (!(total > 0)) return `Downloaded ${mb(bytes)} MB, ${rateText(rate)}`;
  const p = Math.floor(Math.min(1, bytes / total) * 100);
  return `Downloaded ${mb(bytes)} of ${mb(total)} MB (${p}%), ${rateText(rate)}`;
}

export function createDownloadMeter({ every = 1000, now = Date.now } = {}) {
  let lastAt = null, lastBytes = 0;
  return {
    add(bytes, total = 0) {
      const t = now();
      const n = Number(bytes) || 0;
      if (lastAt == null || n < lastBytes) { lastAt = t; lastBytes = n; return null; }
      const ms = t - lastAt;
      if (ms < every) return null;
      const rate = ((n - lastBytes) * 1000) / ms;
      lastAt = t; lastBytes = n;
      return { bytes: n, total: Number(total) > 0 ? Number(total) : 0, rate };
    },
  };
}
