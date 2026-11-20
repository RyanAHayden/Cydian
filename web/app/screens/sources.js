// Sources tab, after Cydia's (docs/cydia.md "Sources tab"): one row per source, sorted by name, with its
// CydiaIcon.png, name, URL and (iFizBox's own addition) how many packages it has for this device's architecture.
// Nav bar: Refresh (F150 reload bar, refetch every source) and Manage (F45, screens/manage.js: the edit list with Add, delete
// and reorder, Import & Export, Recommended). A left swipe on a row shows Delete. Rows keep the order set there. The list lives on the
// device and comes through the backend (core/sources.js sourceCalls), so the app runs this file unchanged.
// Above the sources, Cydia's "All Sources" row; a source (or All Sources) opens its Sections, and everything
// below that is screens/browse.js.
import { cleanSourceUrl } from "../core/sources.js";
import { plain, collapse, note } from "../nav/ui.js";
import * as browse from "./browse.js";
import { showAlert } from "../nav/alert.js";
import { showMenu, longPress, copyText, nativePaste } from "../nav/menu.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { displayName, sourceIcons, sourceSubtitle, sourcesFor, sourceFilter, loadNeverLoaded } from "../core/sources.js";
import { sourceIconImage } from "../source-icon.js";
import { settings } from "./settings.js";
import * as manage from "./manage.js";
import { orderSources, loadOrder, filterSources } from "../core/sourcelist.js";
import { healthOf } from "../core/health.js";
import { recommendedSeen, jailbreakName } from "../core/recommended.js";
import { builtinFirst, isBuiltin } from "../core/essential.js";
import { lockMark } from "../nav/lock.js";
import { searchBar, pinned } from "../nav/searchbar.js";
import { pullToRefresh } from "../nav/pullrefresh.js";
import { reloadSteps } from "../core/reloadsteps.js";
import { showBanner } from "../nav/banner.js";
import { failedBanner, FAILED_BANNER_MS } from "../core/aptupdate.js";
import { refreshRows, tabBadge, coalesce, ROW } from "../core/refreshrows.js";

export const title = "Sources";

// F233: while a refresh runs, every row shows where its source is (core/refreshrows.js): grey Waiting, the spinner,
// then its package count, or a red badge with the reason in red under its name. A tap on a failed row refreshes that
// source alone (retry). The reload bar (nav/reloadbar.js) says what is happening, the Sources tab's badge spins and
// then counts the failures, and the page can be left while it runs. No count strip over the list: Cydia has none.
// Each source's packages go to the catalog (Changes, Search) as soon as it has landed, not after the last one.

const state = {
  sources: null,   // the list as last loaded, sorted
  body: null,      // the root page's scroller
  busy: false,     // a refresh is running
  tried: new Set(), // F43: keys first-loaded this session (core/sources.js loadNeverLoaded)
  loading: new Set(), // keys being refreshed right now: their rows spin, the Sources badge spins (Cydia)
  query: "",        // F19: the search box's text
  bar: null,        // F19: the search box, kept across redraws so typing keeps its focus
  box: null,        // F19: where the list goes, under the search box
  rows: null,       // F233: the last refresh's rows (core/refreshrows.js), kept after it ends for the failed ones
  running: false,   // F233: a refresh (or a row's retry) is under way
};

const byKey = (key) => state.sources?.find((s) => s.key === key);

// iOS keeps a button in :active after its Paste bubble took the touch, and no class can win over that in every theme:
// taking the button out and putting it back (listeners kept) drops it from WebKit's active chain.
function reset(button) {
  button.classList.remove("is-pressed");
  const parent = button.parentNode, next = button.nextSibling;
  if (!parent) return;
  button.remove();
  parent.insertBefore(button, next);
}

// Add opens the Enter APT URL alert inside the tap. The website reads no clipboard on its own: the alert's Paste
// button asks Safari (nav/alert.js), so there is no Paste bubble on Add and no blue Type state. The app reads
// UIPasteboard on Add (addFromPasteboard, below).
// `native` and `open` are for tests (screens/addsource.test.js): the bridge, and manage.addSource.
export async function addFromClipboard(ctx, button, { native = globalThis.ifizboxNative, open = manage.addSource } = {}) {
  if (native) return addFromPasteboard(ctx, button, native, open);
  reset(button);
  return open(ctx, null);
}

// The app (F105): UIPasteboard, no Paste bubble, so no Type. Enter APT URL opens inside the tap, the field "https://"
// with the keyboard up, and takes the copied source URL when the bridge answers. Opened after that round trip (as
// ffaf27e did) the alert came outside the tap: WKWebView raised no keyboard and the button kept its pressed look.
// No URL copied, or the read refused (iOS's Allow Paste denied, no clipboard.read): the field stays to type in. Never
// navigator.clipboard here: after an await it would bring back WebKit's bubble without Type.
async function addFromPasteboard(ctx, button, native, open) {
  button.textContent = "Add";
  button.classList.remove("done");
  reset(button);
  const shown = open(ctx, null); // showAlert builds the alert before its first await
  const field = [...document.querySelectorAll(".alert-field")].pop();
  const start = field?.value;
  let typed = false;
  field?.addEventListener("input", () => { typed = true; }, { once: true });
  // F146: `auto`: not a tap on Paste, so the sideload build reads only a copied URL, asks iOS once per copy and
  // never again after a refusal (Bridge.swift clipboard.read); the jailbreak build reads without asking.
  const url = cleanSourceUrl((await nativePaste(native, { auto: true })) ?? "");
  // Only an untouched field still on screen: never over what the user started typing.
  if (url && field?.isConnected && !typed && field.value === start) field.value = url;
  return shown;
}

export function nav(route, ctx) {
  if (manage.isManage(route)) return manage.nav(route, ctx);
  if (route.path.length) {
    return browse.nav(route, (key) => { const s = byKey(key); return s ? displayName(s) : null; });
  }
  return {
    title: "Sources", style: "plain",
    left: { label: "Refresh", onClick: () => refresh(ctx) },
    right: [
      // Add: the Enter APT URL alert at once; the app fills it from UIPasteboard, the website through its Paste button.
      { label: "Add", onClick: (e) => addFromClipboard(ctx, e.currentTarget) },
      { label: "Manage", onClick: () => ctx.go({ tab: "sources", path: [manage.SEGMENT] }) },
    ],
  };
}

// Device (F37) changes which sources show: redraw the list if it is on screen.
settings.onChange((key) => { if (key === "device" && state.body?.isConnected) draw(); });

// F45: an add, delete or reorder in Manage reloads the list, so it is right when the user goes back.
// B75: and a source just added starts loading at once, under the reload bar (`ctx` from Manage's Add paths), even
// when the Sources list was never drawn, so Search finds its packages without a visit here.
// B141: and a source that came in already read (Add's IPA record, the website's Open in App import) goes into the
// catalog at once (feedCatalog: ctx.loadData), so Search finds its apps without a Refresh.
manage.onSourcesChanged((ctx) => {
  if (state.body) load(ctx ?? state.ctx); else loadNew(ctx);
  feedCatalog(ctx ?? state.ctx);
});

// B141: the app's ctx, for loads started where no screen hands one (the website's import at first launch): the
// reload bar, the badge and catalog loads. A screen's own ctx, once given, stays.
export function useContext(ctx) { state.ctx ??= ctx; }

export function render(el, route, ctx) {
  if (manage.isManage(route)) {
    manage.render(el, route, ctx);
    return;
  }
  if (route.path.length) {
    browse.render(el, route, ctx);
    return;
  }
  state.body = el;
  state.ctx = ctx; // F233: a failed row's retry, from the list's click handler
  draw();
  load(ctx);
}

async function load(ctx) {
  if (ctx) state.ctx = ctx;
  try {
    state.sources = await getBackend().sources();
  } catch (e) {
    state.sources = [];
    state.loadError = e.message;
  }
  draw();
  if (!state.loadError) firstLoad(ctx);
}

// F43: sources seeded by default (F28) hold only their URL until something reads them: refresh those once, with
// the reload bar, so a first visit shows names, icons and counts without a tap.
// B75: `fresh` reads the list first (a source just added, Search), inside the busy section so two callers never
// start two runs; a call while another run is busy marks `again` and gets that run's promise (null for a Refresh).
// Resolves to the refreshed records, or null when nothing needed loading.
function firstLoad(ctx, { fresh = false, backend = getBackend(), retry = null } = {}) {
  if (state.busy) { state.again = true; if (retry) state.againRetry = retry; return state.current ?? Promise.resolve(null); }
  state.busy = true;
  let run = null;
  const job = (async () => {
    let done = null;
    try {
      if (fresh) state.sources = await backend.sources();
      // F150: the reload bar instead of a HUD, so the list stays usable while the new sources load.
      done = await loadNeverLoaded(backend, state.sources, settings.deviceType(), {
        tried: state.tried,
        retry, // B141: Search's per-visit second try of failed sources
        // the bar ends in the finally below; begin hands back a no-op `end` (B75: none made end() throw, so the
        // list was never read again after a first load)
        begin: (keys) => { run = startRun(ctx, [...(keys ?? [])]); return () => {}; },
        onEach: (d) => run?.onEach(d),
        onRow: (k, st, why) => run?.onRow(k, st, why),
      });
      if (done && !run?.cancelled) {
        state.sources = await backend.sources();
        draw();
      }
    } catch {
      // a failed first load leaves the rows as they were; Refresh shows the error
    } finally {
      if (run && !run.cancelled) { clearLoading(ctx); run.end(); }
      state.busy = false;
      state.current = null;
      runAgain(ctx, run?.cancelled);
      settle();
    }
    return done;
  })();
  state.current = job;
  return job;
}

// ---- B75: sources just added load at once, wherever the user is ----------------------------------------------

// Sources the device has never loaded (one just added by Add, Add All, Import, or Search's Recommended Add) start
// loading now: firstLoad's one run under the reload bar, with the words, rows, badge and Cancel of Refresh, whichever
// tab is open. Search calls it on opening and as a query is typed; Manage's adds through onSourcesChanged. Each
// source is tried once per session (state.tried, shared by every caller). `backend` is for the tests.
// B141: `retry` (a Set Search keeps per visit, core/sources.js loadNeverLoaded) also loads failed or empty sources
// once more.
export function loadNew(ctx = state.ctx, { backend, retry } = {}) {
  if (ctx) state.ctx = ctx;
  return firstLoad(ctx ?? state.ctx, { fresh: true, ...(backend ? { backend } : {}), ...(retry ? { retry } : {}) });
}

// B141: a run (Refresh at launch, a first load, a row's retry) is under way: Search says sources are still loading
// instead of No Results. onSettled(f) is told each time one ends with no other started; returns unsubscribe.
export const isLoading = () => state.busy;
const settledListeners = new Set();
export function onSettled(f) { settledListeners.add(f); return () => settledListeners.delete(f); }
function settle() {
  if (state.busy) return;
  for (const f of [...settledListeners]) { try { f(); } catch { /* one listener's error stops no other */ } }
}

// Called with no arguments each time a landed source's packages are in the catalog (after ctx.loadData), for a
// Refresh, a retry or loadNew alike: Search runs its query again. Returns unsubscribe.
const landedListeners = new Set();
export function onLanded(f) { landedListeners.add(f); return () => landedListeners.delete(f); }
function fireLanded() {
  for (const f of [...landedListeners]) { try { f(); } catch { /* one listener's error stops no other */ } }
}

// A loadNew asked for while another run held the busy flag (a source added during a Refresh): run it once that ends,
// unless that run was cancelled (Cancel means stop, not start the next bar).
function runAgain(ctx, cancelled = false) {
  if (!state.again) return;
  state.again = false;
  const retry = state.againRetry;
  state.againRetry = null;
  if (cancelled) return;
  loadNew(ctx ?? state.ctx, retry ? { retry } : {});
}

// Loading marks: the rows of `keys` spin and the Sources tab's badge spins until each answers (onEach), as
// Cydia does. Returns onEach for refreshSources.
// globalThis.ifizboxRefreshing: how many sources are refreshing now, for Home's tile (with the ifizbox:refreshing event).
function announce() {
  globalThis.ifizboxRefreshing = state.loading.size;
  globalThis.dispatchEvent?.(new Event("ifizbox:refreshing"));
}
function markLoading(ctx, keys) {
  for (const k of keys) state.loading.add(k);
  state.rows = refreshRows(keys);
  state.running = true;
  announce();
  ctx?.setBadge?.("sources", state.loading.size ? "spinner" : null);
  paintAll();
  return (done) => {
    state.loading.delete(done?.key);
    const i = state.sources?.findIndex((s) => s.key === done?.key) ?? -1;
    if (i >= 0) state.sources[i] = done;
    state.rows?.land(done);
    paintKey(done?.key);
    feedCatalog(ctx);
    // every source has answered: the badge stops spinning and counts the failures (the catalog load may go on)
    if (!state.loading.size) { ctx?.setBadge?.("sources", tabBadge(state.rows?.counts(), false)); announce(); }
  };
}
function clearLoading(ctx) {
  state.loading.clear();
  announce();
  state.rows?.finish();
  state.running = false;
  ctx?.setBadge?.("sources", tabBadge(state.rows?.counts(), false));
  paintAll();
}

// F233: apt's live lines (backend-native) and the pools (core/sources.js, core/altstore.js) say when a source starts,
// and apt when one fails, before its record lands.
function rowEvent(key, rowState, reason) {
  if (!state.rows?.has(key)) return;
  if (rowState === ROW.failed) state.rows.fail(key, reason);
  else state.rows.set(key, rowState);
  paintKey(key);
}

// F233: a landed source's packages into the catalog at once (ctx.loadData: catalog.ensure, which reads only the
// sources whose refresh time changed), one load at a time however fast they land.
let feeding = null;
function feedCatalog(ctx) {
  if (!ctx?.loadData) return;
  // B75: onLanded's listeners hang off the same promise, so the load's own timing is as it was
  feeding ??= coalesce(() => {
    const p = ctx.loadData();
    Promise.resolve(p).then(fireLanded, () => {});
    return p;
  });
  feeding();
}

// ---- F233: the rows' states and the retry --------------------------------------------------------------------

const rowOf = (key) => document.querySelector(`.source-row[data-key="${CSS.escape(String(key))}"]`);
function paintKey(key) { const li = key == null ? null : rowOf(key); if (li) paintRow(li); }
function paintAll() { for (const li of document.querySelectorAll(".source-row")) paintRow(li); }

// One row as its refresh state says. Rows outside a refresh (state.rows null, or a key it doesn't hold) keep what
// draw() gave them: the stored count, and "Not Responding" for a source whose last refresh failed.
function paintRow(li) {
  const r = state.rows?.get(li.dataset.key) ?? null;
  const st = r?.state ?? null;
  li.classList.toggle("is-waiting", st === ROW.waiting);
  li.classList.toggle("is-loading", st === ROW.loading);
  li.classList.toggle("is-failed", st === ROW.failed);
  const inner = li.querySelector(".cell-inner");
  if (!inner) return;
  const text = inner.querySelector(".cell-text");
  let count = inner.querySelector(".cell-count");
  let waiting = inner.querySelector(".row-waiting");
  if (st === ROW.waiting && !waiting) {
    waiting = Object.assign(document.createElement("span"), { className: "row-waiting", textContent: "Waiting" });
    text?.after(waiting);
  } else if (st !== ROW.waiting) waiting?.remove();
  if ((st === ROW.done && r.count != null) || st === ROW.failed) {
    if (!count) { count = Object.assign(document.createElement("span"), { className: "cell-count" }); inner.append(count); }
    count.classList.toggle("row-failed-badge", st === ROW.failed);
    count.textContent = st === ROW.failed ? "!" : r.count.toLocaleString();
  } else count?.classList.remove("row-failed-badge");
  const sub = inner.querySelector(".cell-subtitle");
  if (sub) {
    sub.dataset.plain ??= sub.textContent;
    const was = sub.dataset.error === "1";
    if (st === ROW.failed) {
      if (!was) sub.dataset.wasError = sub.classList.contains("cell-error") ? "1" : "";
      sub.textContent = r.reason || "Failed";
      sub.classList.add("cell-error");
      sub.dataset.error = "1";
    } else if (was) {
      sub.textContent = sub.dataset.plain;
      delete sub.dataset.error;
      // landed fine this time: no red; no refresh state any more (cancelled): as draw() had it
      sub.classList.toggle("cell-error", !st && sub.dataset.wasError === "1");
    }
  }
  li.setAttribute("aria-busy", String(st === ROW.waiting || st === ROW.loading));
  if (st === ROW.failed) inner.setAttribute("aria-description", "Failed to refresh: tap to try again");
  else inner.removeAttribute("aria-description");
}

// F233: a tap on a failed row: that source alone refreshes (the app runs apt-get update for its list only, through
// refreshSources' `retry`), its row spinning; afterwards the badge counts the failures again.
export async function retrySource(ctx, key) {
  if (state.busy || !state.rows?.has(key)) return false;
  state.busy = true;
  state.running = true;
  state.rows.retry(key);
  state.loading.add(key);
  announce();
  ctx?.setBadge?.("sources", "spinner");
  paintKey(key);
  let landed = false;
  try {
    await getBackend().refreshSources((d) => {
      if (d?.key !== key) return;
      landed = true;
      const i = state.sources?.findIndex((s) => s.key === key) ?? -1;
      if (i >= 0) state.sources[i] = d;
      state.rows?.land(d);
      feedCatalog(ctx);
    }, { filter: (s) => s?.key === key, retry: true, onRow: (k, st, why) => { if (k === key) rowEvent(k, st, why); } });
    if (!landed) state.rows?.fail(key, "No answer");
  } catch (e) {
    state.rows?.fail(key, e?.message || String(e));
  } finally {
    state.loading.delete(key);
    state.running = false;
    state.busy = false;
    runAgain(ctx); // B75
    settle();
    state.rows?.finish();
    announce();
    ctx?.setBadge?.("sources", tabBadge(state.rows?.counts(), false));
    paintKey(key);
  }
  return true;
}

// At launch (app.js, Settings > Refresh on Launch): every source the device type shows, behind whatever page is
// open, with the Sources tab's red spinning badge and the rows spinning if Sources is on screen. The reload bar (F150) says what is happening.
// F150: with the reload bar, whose Cancel stops it: resolves to "cancelled" then (Home's Reload stops there too).
export async function refreshInBackground(ctx) {
  if (state.busy) return;
  state.busy = true;
  let run = null;
  try {
    state.sources = await getBackend().sources();
    const filter = sourceFilter(settings.deviceType());
    run = startRun(ctx, state.sources.filter(filter ?? (() => true)).map((x) => x.key));
    const job = getBackend().refreshSources(run.onEach, { filter, signal: run.signal, onRow: run.onRow });
    if (await run.until(job)) return "cancelled";
    bannerFailed(await job);
    state.sources = await getBackend().sources();
    if (state.box?.isConnected) draw();
    if (await run.until(run.data())) return "cancelled";
  } catch {
    // a failed refresh shows per source (its row) once it has failed
  } finally {
    if (!run?.cancelled) { clearLoading(ctx); run?.end(); }
    state.busy = false;
    runAgain(ctx, run?.cancelled); // B75
    settle();
  }
}

// B23: the sources apt-get update failed on (refreshSources' `failed`, the jailbreak app) in a banner that goes by
// itself and opens Sources when tapped, never an alert: their rows are marked (Not Responding) for Edit to remove.
export function bannerFailed(rows, { banner = showBanner, go = (href) => { location.hash = href.replace(/^#/, ""); } } = {}) {
  const words = failedBanner(rows?.failed);
  if (!words) return false;
  banner({ ...words, duration: FAILED_BANNER_MS, onTap: () => go(format({ tab: "sources", path: [] })) });
  return true;
}

// ---- F150: one refresh under the reload bar -----------------------------------------------------------------

// Marks `keys` loading (rows and badge, markLoading) and drops the reload bar (ctx.reloadBar, nav/reloadbar.js;
// none where ctx has no reloadBar, as in the tests that don't ask for it), its words following the refresh
// (core/reloadsteps.js). The bar's Cancel ends the run at once: the marks go, the bar goes, `until` resolves true,
// `signal` aborts (the backend starts no more sources) and the answers still on their way change nothing.
//   onEach(record)  until(promise) -> true when cancelled first   data()  end()   cancelled   signal
export function startRun(ctx, keys) {
  const ac = typeof AbortController === "function" ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
  const each = markLoading(ctx, keys);
  const byKey = new Map((state.sources ?? []).map((s) => [s.key, s]));
  let bar = null;
  let stop = () => {};
  const stopped = new Promise((resolve) => { stop = resolve; });
  const run = {
    signal: ac.signal,
    get cancelled() { return ac.signal.aborted; },
    onEach(d) { if (ac.signal.aborted) return; each(d); steps.each(d); },
    // F233: a source started (or, from apt's live lines, failed) before its record lands.
    onRow(key, rowState, reason) { if (!ac.signal.aborted) rowEvent(key, rowState, reason); },
    until: (p) => Promise.race([Promise.resolve(p).then(() => false), stopped.then(() => true)]),
    // Cydia's last steps: the package lists into the catalog ("Loading Data"), then what is worked out from
    // them ("Building Searcher Cache"): ctx.loadData and ctx.buildCache (app.js), skipped where ctx has none.
    async data() {
      if (ac.signal.aborted) return;
      steps.load();
      await ctx?.loadData?.();
      if (ac.signal.aborted) return;
      steps.cache();
      await ctx?.buildCache?.();
    },
    end() { bar?.hide(); },
  };
  const cancel = () => {
    if (ac.signal.aborted) return;
    ac.abort();
    state.rows = null; // F233: cancelled: no rows or failure count from a run that didn't finish
    clearLoading(ctx);
    bar?.hide();
    stop();
  };
  const steps = reloadSteps(keys.map((k) => byKey.get(k) ?? { key: k }), {
    apt: Boolean(globalThis.ifizboxNative) && settings.deviceType() !== "none",
    name: (s) => (s?.uri || s?.name ? displayName(s) : ""),
    onText: (t) => bar?.set(t),
  });
  bar = ctx?.reloadBar?.(steps.text(), { onCancel: cancel }) ?? null;
  return run;
}


// ---- the list --------------------------------------------------------------------------------------------

// F19: the search box above the list, the iOS 6 grey search bar Search uses (packages.css .search-bar). It filters
// the rows as you type (core/sourcelist.js filterSources); All Sources steps aside while a search is on.
// C10: the shared bar (nav/searchbar.js), with Cancel.
function sourcesSearchBar() {
  if (state.bar) return state.bar;
  return (state.bar = searchBar({ placeholder: "Search Sources", ariaLabel: "Search sources: name or URL", value: state.query,
    className: "sources-search", onQuery: (q) => { if (q !== state.query) { state.query = q; draw(); } } }));
}

// F19 first run: on a jailbroken type, a row to Recommended (named for the jailbreak once it's known) until
// Recommended has been opened once.
function recommendedRow() {
  if (settings.deviceType() === "none" || recommendedSeen()) return null;
  return { label: "Recommended Sources", subtitle: "sources that suit this jailbreak",
    href: format({ tab: "sources", path: [manage.SEGMENT, "recommended"] }) };
}

function draw() {
  const el = state.body;
  if (!el) return;
  if (!state.sources) { el.classList.remove("search-root"); el.replaceChildren(); return; }
  if (state.loadError) {
    el.classList.remove("search-root");
    el.replaceChildren(note(state.loadError));
    return;
  }
  const bar = sourcesSearchBar();
  // C10: the bar stays put; the list scrolls under it (nav/searchbar.js pinned).
  const results = state.box?.parentNode;
  if (!state.box || results?.parentNode !== el || bar.parentNode !== el) {
    state.box = document.createElement("div");
    el.replaceChildren();
    pinned(el, bar).append(state.box);
  }
  // F270: pull the list down past its top: Refresh, as the nav button.
  pullToRefresh(state.box.parentNode, { onRefresh: () => refresh(state.ctx), busy: () => state.busy || state.running, settings });
  const box = state.box;
  const backend = getBackend();
  // F37: Not Jailbroken shows AltStore sources only. F144: and says nothing of APT ones (no count, no hint).
  // F45: in the order set in Manage > Sources (none set: by name).
  // F72: iFizBox's own source (built in) stays first whatever the order.
  const { shown } = sourcesFor(builtinFirst(orderSources(state.sources, loadOrder())), settings.deviceType());
  const searching = Boolean(state.query.trim());
  const list = filterSources(shown, state.query, displayName);
  const rec = searching ? null : recommendedRow();
  const top = searching ? [] : [{
    label: "All Sources",
    subtitle: "combined package list for the sources below",
    href: format({ tab: "sources", path: ["*"] }),
  }, ...(rec ? [rec] : [])];
  const ul = plain([...(top.length ? [{ rows: top }] : []), {
    header: searching ? `${list.length} of ${shown.length}` : "Individual Sources",
    rows: list.map((s) => {
      const health = healthOf(s);
      return {
        label: displayName(s),
        // F44: github.com/<user>/<repo> for GitHub-hosted sources. F19: a source whose last refresh failed says so.
        subtitle: health.state === "down" ? `Not Responding · ${sourceSubtitle(s)}` : sourceSubtitle(s),
        icon: { text: displayName(s)[0]?.toUpperCase() ?? "?" },
        badge: typeof s.count === "number" ? s.count.toLocaleString() : undefined,
        href: format({ tab: "sources", path: [s.key] }),
      };
    }),
  }]);
  const cells = ul.querySelectorAll(":scope > .cell");
  if (top.length) {
    cells[0].classList.add("all-sources-row");
    cells[0].querySelector(".cell-inner").prepend(Object.assign(document.createElement("span"), { className: "folder" }));
  }
  if (rec) {
    cells[1].classList.add("recommended-row");
    manage.currentJailbreak().then((jb) => {
      const label = cells[1].querySelector(".cell-label");
      if (jb.id && jb.id !== "other" && label) label.textContent = `Recommended for ${jailbreakName(jb.id)}`;
    }).catch(() => {});
  }
  list.forEach((s, i) => decorate(cells[i + top.length], s, backend));
  attachRowGestures(ul);
  box.replaceChildren(ul);
  if (!list.length) {
    box.append(note(searching ? "No sources match." : "No sources. Tap Manage, then Sources."));
  }
}

function decorate(li, source, backend) {
  li.classList.add("source-row");
  li.dataset.key = source.key;
  const loading = state.loading.has(source.key);
  // a source shows as failed only once a load has actually failed, not while one is under way
  if (source.error && !loading) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  // F16a: a source only its own app can read (an encrypted GBox one) says so under its name; its page says why.
  if (source.unsupported && !source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  paintRow(li); // F233: Waiting / spinner / count / red badge, while and after a refresh
  // CydiaIcon.png loads behind the letter and replaces it once it's there (Cydia: unknown.png, then the icon).
  // Cydia's <base>CydiaIcon.png first, then the repo's top level for dist repos (sourceIconUrls).
  // An AltStore source (F9) names its icon in its JSON. A GitHub-hosted source without one gets its owner's
  // avatar (F44, core/sources.js sourceIcons). B58: in the app, from the device's icon cache (source-icon.js).
  li.querySelector(".cell-icon").append(sourceIconImage(source.key, sourceIcons(source), backend));
  li.dataset.url = source.uri; // Copy URL (hold the row)
  // F72: iFizBox's own source is built in: a lock after its name, and no Delete (a swipe arms nothing).
  if (isBuiltin(source)) {
    li.dataset.builtin = "1";
    li.querySelector(".cell-label")?.append(lockMark("name-lock"));
    return;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "del-toggle";
  toggle.setAttribute("aria-label", "Delete " + displayName(source));
  toggle.addEventListener("click", () => arm(li, !li.classList.contains("armed")));
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "del-confirm";
  confirm.textContent = "Delete";
  confirm.addEventListener("click", () => remove(li, source));
  li.append(toggle, confirm);
  li.dataset.url = source.uri; // Copy URL (hold the row)
}

function arm(li, on) {
  if (li.dataset.builtin) return; // F72: built in, nothing to delete
  for (const other of li.parentNode.querySelectorAll(".source-row.armed")) if (other !== li) other.classList.remove("armed");
  li.classList.toggle("armed", on);
}

// While a row shows Delete, a tap on a row doesn't open it: it only puts the Delete away.
// A left swipe on a row shows its Delete; a right swipe hides it.
function attachRowGestures(ul) {
  // Hold a source: iOS 6's black menu with Copy URL.
  longPress(ul, ".source-row", (li, e) => {
    if (state.editing || li.classList.contains("armed") || !li.dataset.url) return;
    // F233: a failed row's tap retries it, so the menu opens its packages (the lists from before) instead
    const open = li.classList.contains("is-failed") && state.ctx?.go
      ? [{ label: "Open", onClick: () => state.ctx.go({ tab: "sources", path: [li.dataset.key] }) }] : [];
    showMenu(li, [...open, { label: "Copy URL", onClick: () => copyText(li.dataset.url) }], { x: e.clientX });
  });
  let start = null;   // the pointer that may become a swipe
  let swiped = false; // the click that ends a swipe opens nothing
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = ul.querySelector(".source-row.armed");
    // F233: a tap on a row whose refresh failed tries that source again instead of opening it
    const failed = !armed && !swiped ? e.target.closest(".source-row.is-failed") : null;
    if (failed) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.busy) retrySource(state.ctx, failed.dataset.key);
      return;
    }
    if (!armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);

  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".source-row");
    swiped = false;
    start = li && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
  });
  ul.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // a scroll
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    arm(start.li, dx < 0);
    swiped = true;
    start = null;
  });
  const stop = () => { start = null; };
  ul.addEventListener("pointerup", stop);
  ul.addEventListener("pointercancel", stop);
}

async function remove(li, source) {
  li.classList.add("removing");
  try {
    await getBackend().removeSource(source.key);
  } catch (e) {
    li.classList.remove("removing");
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
    return;
  }
  state.sources = state.sources.filter((s) => s.key !== source.key);
  setTimeout(() => {
    if (!state.sources.length) { li.remove(); draw(); return; }
    collapse(li);
  }, 200);
}


// ---- Refresh and Add -------------------------------------------------------------------------------------

// F150: under the reload bar (startRun), not a HUD: nothing is blocked while it runs, and its Cancel stops it.
async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  let run = null;
  try {
    const filter = sourceFilter(settings.deviceType());
    run = startRun(ctx, (state.sources ?? []).filter(filter ?? (() => true)).map((x) => x.key));
    const job = getBackend().refreshSources(run.onEach, { filter, signal: run.signal, onRow: run.onRow });
    if (await run.until(job)) return; // F41: only what's shown
    bannerFailed(await job);
    state.sources = await getBackend().sources();
    draw();
    await run.until(run.data());
  } catch (e) {
    if (run?.cancelled) return;
    run?.end();
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    if (!run?.cancelled) { clearLoading(ctx); run?.end(); }
    state.busy = false;
    runAgain(ctx, run?.cancelled); // B75
    settle();
  }
}
