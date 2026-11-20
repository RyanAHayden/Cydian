// B177: a source whose refresh failed, on its own page (an APT source's Sections, screens/browse.js, or an app
// source's page, screens/altstore.js): the whole error, readable, and what can be done about it. A tap on a failed
// row on Sources opens this page like any other source's (the hold menu keeps Refresh).
//
// Cydia draws a package's warnings as rows on a pale red (#fdd) background (docs/cydia.md "Package page"); a source's
// errors take that look here, under a "Refresh Failed" header, followed by the actions:
//   Refresh Source   that source alone again (sources.js retrySource: its row on Sources spins, the badge counts)
//   Edit Source      the Enter URL alert filled with its URL; a new URL that verifies replaces the old source
//   Copy Error       the source's name, URL and error on the clipboard
//   Share Error      the same text through the share sheet (copied where there is none)
//   Remove Source    after an alert, as Delete on Sources does; the page goes Back
//
// sources.js hands over what this file can't import without a cycle (it imports browse.js, which imports this):
//   setSourceErrorHooks({ refresh(key) -> Promise, reason(key) -> live reason | null, edit(ctx, source) -> Promise
//     of the new record | null, removed(ctx, key) })
//
//   sourceErrors(source, status, live) -> [text]   every distinct error the record, apt and the catalog hold
//   errorReport(source, errors) -> text            what Copy and Share hand on
//   sourceErrorGroup(source, { status, ctx, onChange }) -> element | null   null when the source has no error
import { el, grouped } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { copyText } from "../nav/menu.js";
import { showHUD } from "../nav/hud.js";
import { getBackend } from "../backend.js";
import { displayName } from "../core/sources.js";
import { isBuiltin } from "../core/essential.js";

const hooks = { refresh: null, reason: () => null, edit: null, removed: null };
export function setSourceErrorHooks(h) { Object.assign(hooks, h); }

// The errors to show, first the live one (this session's refresh), then the stored record's, apt's and the
// catalog's; each once, however many places hold it ("not_found: x" and "x" count as the same).
export function sourceErrors(source, status = null, live = null) {
  const out = [];
  const bare = (s) => s.replace(/^[a-z_]+: /, "");
  for (const e of [live, source?.error, source?.aptError, status?.error]) {
    const t = typeof e === "string" ? e.trim() : e ? String(e).trim() : "";
    if (!t) continue;
    // one holding the other counts as the same too (apt's line inside a longer message), unless it is a mere word
    const holds = (a, b) => b.length >= 12 && a.includes(b);
    const i = out.findIndex((o) => bare(o) === bare(t) || holds(o, t) || holds(t, o));
    if (i < 0) out.push(t);
    else if (t.length > out[i].length) out[i] = t; // keep the longer, fuller one
  }
  return out;
}

const where = (s) => [s?.uri, s?.dist && s.dist !== "./" ? s.dist : "", ...(s?.dist && s.dist !== "./" ? s?.components ?? [] : [])]
  .filter(Boolean).join(" ");

export function errorReport(source, errors) {
  return [`${displayName(source ?? {})} couldn't be refreshed.`, where(source), "", ...errors].join("\n").trim() + "\n";
}

export function sourceErrorGroup(source, { status = null, ctx = null, onChange = () => {} } = {}) {
  if (!source?.key) return null;
  const errors = sourceErrors(source, status, hooks.reason?.(source.key));
  if (!errors.length) return null;
  const wrap = el("div", "source-error");

  // The error itself: every line, wrapped, selectable (a hold selects it, as text on a web page).
  const g = el("div", "group");
  g.append(el("h2", "group-header", "Refresh Failed"));
  const ul = el("ul", "table grouped");
  const li = el("li", "cell source-error-cell");
  const inner = el("div", "cell-inner");
  const text = el("div", "source-error-text");
  for (const e of errors) text.append(el("p", null, e));
  inner.append(text);
  li.append(inner);
  ul.append(li);
  g.append(ul);
  g.append(el("p", "group-footer", where(source))); // the URL it tried (the page's own footer has Not Responding)
  wrap.append(g);

  const report = errorReport(source, errors);
  const rows = [
    { label: "Refresh Source", cls: "source-error-refresh", onClick: (e) => refreshNow(e.currentTarget, source, onChange) },
    ...(hooks.edit && !isBuiltin(source) ? [{ label: "Edit Source", onClick: () => editNow(ctx, source, onChange) }] : []),
    { label: "Copy Error", onClick: () => copyNow(report) },
    { label: "Share Error", onClick: () => shareNow(source, report) },
  ];
  wrap.append(grouped([{ rows }]));
  if (!isBuiltin(source)) {
    wrap.append(grouped([{ rows: [{ label: "Remove Source", cls: "source-error-remove", onClick: () => removeNow(ctx, source) }] }]));
  }
  return wrap;
}

// Refresh Source: a spinner where the row's detail goes while it runs; the page redraws when it ends (onChange).
async function refreshNow(button, source, onChange) {
  if (!hooks.refresh || button.classList.contains("is-busy")) return;
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
  const spin = el("span", "loading-spinner");
  button.append(spin);
  let ok = true;
  try { ok = (await hooks.refresh(source.key)) !== false; } catch { ok = true; /* the record carries the error */ }
  spin.remove();
  button.classList.remove("is-busy");
  button.removeAttribute("aria-busy");
  if (!ok) {
    await showAlert({ title: "Refreshing", message: "Sources are being refreshed. Try again when that ends.", buttons: ["OK"] });
    return;
  }
  onChange();
}

async function editNow(ctx, source, onChange) {
  const saved = await hooks.edit?.(ctx, source);
  if (saved?.key && saved.key !== source.key) {
    try { await getBackend().removeSource(source.key); } catch { /* the new one is in; the old one can be removed by hand */ }
    hooks.removed?.(ctx, source.key);
    // the new source's own page in this one's place
    if (ctx?.back && ctx?.go) { ctx.back(); setTimeout(() => ctx.go({ tab: "sources", path: [saved.key] }), 350); }
    return;
  }
  if (saved) onChange();
}

async function copyNow(report) {
  await copyText(report);
  showHUD("Copied").done("Copied");
}

async function shareNow(source, report) {
  if (navigator.share) {
    try { await navigator.share({ title: displayName(source), text: report }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  await copyNow(report); // no share sheet here (or it refused): the clipboard, said so
}

async function removeNow(ctx, source) {
  const name = displayName(source);
  const { index } = await showAlert({ title: `Remove ${name}?`, message: "Its packages go from Changes and Search.",
    buttons: ["Cancel", "Remove"], cancel: 0 });
  if (index !== 1) return;
  try {
    await getBackend().removeSource(source.key);
  } catch (e) {
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    return;
  }
  hooks.removed?.(ctx, source.key);
  ctx?.back?.();
}
