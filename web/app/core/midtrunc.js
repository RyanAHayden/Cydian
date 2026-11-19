// File names cut in the middle, as iOS 6 does (UILineBreakModeMiddleTruncation: Mail's attachments, Safari's
// downloads): the start and the end stay, so 'opentennis-beta-p146.ipa' reads 'opentennis-be…p146.ipa'. CSS only
// cuts the end (text-overflow: ellipsis), so file names go through here; app names and other text keep the tail cut.
//
//   isFileName(text)                 an IPA or .deb file name ("App.ipa", "tweak_1.0_iphoneos-arm64.deb")
//   midTruncate(text, width, measure)  pure: the text unchanged when measure(text) <= width, else the longest
//                                    start + "…" + end that fits, the end always holding the extension. measure(s) ->
//                                    width in the same unit (px from a canvas on the page, chars in the tests)
//   fitName(el, full)                the DOM side: el shows `full` cut to its own width (el.dataset.full keeps it)
//   fitFileNames(root)               every row label, line or name under root that is a file name, fitted now and
//                                    again when its width changes (a ResizeObserver: rotation, Manage's slide)

export const ELLIPSIS = "…";
const FILE_RE = /\.(ipa|deb)$/i;

export const isFileName = (text) => FILE_RE.test(String(text ?? "").trim());

// The extension with its dot ("" when there's none), kept whole at the end of a cut name.
const extOf = (s) => /\.[A-Za-z0-9]{1,8}$/.exec(s)?.[0] ?? "";

export function midTruncate(text, width, measure) {
  const s = String(text ?? "");
  if (!s || !(width > 0) || measure(s) <= width) return s;
  const chars = [...s]; // code points, so a cut never splits a surrogate pair
  const ext = [...extOf(s)].length;
  // k characters kept around the "…": the start gets the larger half, the end at least the extension.
  const cut = (k) => {
    let tail = Math.max(Math.floor(k / 2), Math.min(ext, k));
    let head = k - tail;
    if (head < 1 && k > ext) { head = 1; tail = k - 1; }
    return chars.slice(0, head).join("") + ELLIPSIS + chars.slice(chars.length - tail).join("");
  };
  let lo = 0, hi = chars.length - 1; // the largest k whose cut fits; k = 0 is "…" alone
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(cut(mid)) <= width) lo = mid; else hi = mid - 1;
  }
  return cut(lo);
}

// ---- DOM ----

// Only boxes whose width doesn't follow their text (a column flex item stretched to the row, a block): a box sized by
// its content would shrink with each cut and be cut again.
const SELECTOR = ".cell-label, .cell-subtitle, .qr-name";
let ctx = null;

function measurer(el) {
  ctx ??= globalThis.document?.createElement("canvas").getContext("2d") ?? null;
  const cs = globalThis.getComputedStyle?.(el);
  if (!ctx || !cs) return null;
  ctx.font = cs.font || `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return (s) => ctx.measureText(s).width;
}

export function fitName(el, full = el.dataset.full ?? el.textContent) {
  el.dataset.full = full;
  el.classList.add("midtrunc");
  if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", full);
  const measure = measurer(el);
  const width = el.clientWidth;
  // 1px short of the box: canvas widths round differently from layout, and a name that just misses would get the
  // CSS tail ellipsis on top of the middle one.
  const shown = measure && width > 0 ? midTruncate(full, width - 1, measure) : full;
  if (el.textContent !== shown) el.textContent = shown;
  return shown;
}

let watcher = null;
const watch = (el) => {
  if (!globalThis.ResizeObserver) return;
  watcher ??= new ResizeObserver((entries) => { for (const e of entries) if (e.target.isConnected) fitName(e.target); });
  watcher.observe(el);
};

export function fitFileNames(root) {
  const els = [...(root?.querySelectorAll?.(SELECTOR) ?? [])].filter((el) =>
    el.dataset.full != null || (el.children.length === 0 && isFileName(el.textContent)));
  for (const el of els) { fitName(el); watch(el); }
  return els;
}
