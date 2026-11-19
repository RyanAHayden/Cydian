// Sources tab, after Cydia's (docs/cydia.md "Sources tab"): one row per source, sorted by name, with its
// CydiaIcon.png, name, URL and (iFizBox's own addition) how many packages it has for this device's architecture.
// Nav bar: Refresh (F150 reload bar, refetch every source) and Manage (F45, screens/manage.js: the edit list with Add, delete
// and reorder, Import & Export, Recommended). A left swipe on a row shows Delete. Rows keep the order set there. The list lives on the
// device and comes through the backend (core/sources.js sourceCalls), so the app runs this file unchanged.
// Above the sources, Cydia's "All Sources" row; a source (or All Sources) opens its Sections, and everything
// below that is screens/browse.js.
import { cleanSourceUrl } from "../core/sources.js";
import { plain, collapse } from "../nav/ui.js";
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
import { reloadSteps } from "../core/reloadsteps.js";
import { showBanner } from "../nav/banner.js";
import { failedBanner, FAILED_BANNER_MS } from "../core/aptupdate.js";

export const title = "Sources";

const state = {
  sources: null,   // the list as last loaded, sorted
  body: null,      // the root page's scroller
  busy: false,     // a refresh is running
  tried: new Set(), // F43: keys first-loaded this session (core/sources.js loadNeverLoaded)
  loading: new Set(), // keys being refreshed right now: their rows spin, the Sources badge spins (Cydia)
  query: "",        // F19: the search box's text
  bar: null,        // F19: the search box, kept across redraws so typing keeps its focus
  box: null,        // F19: where the list goes, under the search box
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
manage.onSourcesChanged(() => { if (state.body) load(); });

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
  draw();
  load(ctx);
}

async function load(ctx) {
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
async function firstLoad(ctx) {
  if (state.busy) return;
  state.busy = true;
  let run = null;
  try {
    // F150: the reload bar instead of a HUD, so the list stays usable while the new sources load.
    const done = await loadNeverLoaded(getBackend(), state.sources, settings.deviceType(), {
      tried: state.tried,
      begin: (keys) => { run = startRun(ctx, [...(keys ?? [])]); },
      onEach: (d) => run?.onEach(d),
    });
    if (done && !run?.cancelled) {
      state.sources = await getBackend().sources();
      draw();
    }
  } catch {
    // a failed first load leaves the rows as they were; Refresh shows the error
  } finally {
    if (!run?.cancelled) { clearLoading(ctx); run?.end(); }
    state.busy = false;
  }
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
  announce();
  ctx?.setBadge?.("sources", state.loading.size ? "spinner" : null);
  for (const li of document.querySelectorAll(".source-row")) li.classList.toggle("is-loading", state.loading.has(li.dataset.key));
  return (done) => {
    state.loading.delete(done?.key);
    const i = state.sources?.findIndex((s) => s.key === done?.key) ?? -1;
    if (i >= 0) state.sources[i] = done;
    const li = document.querySelector(`.source-row[data-key="${CSS.escape(String(done?.key))}"]`);
    if (li) li.classList.remove("is-loading");
    if (!state.loading.size) { ctx?.setBadge?.("sources", null); announce(); }
  };
}
function clearLoading(ctx) {
  state.loading.clear();
  announce();
  ctx?.setBadge?.("sources", null);
  for (const li of document.querySelectorAll(".source-row.is-loading")) li.classList.remove("is-loading");
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
    const job = getBackend().refreshSources(run.onEach, { filter, signal: run.signal });
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
function searchBar() {
  if (state.bar) return state.bar;
  const bar = document.createElement("form");
  bar.className = "search-bar sources-search";
  bar.setAttribute("role", "search");
  const field = document.createElement("label");
  field.className = "search-field";
  const input = document.createElement("input");
  Object.assign(input, { type: "search", placeholder: "Search Sources", autocapitalize: "off", autocomplete: "off",
    spellcheck: false, enterKeyHint: "search", value: state.query });
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Search sources: name or URL");
  input.addEventListener("input", () => { state.query = input.value; draw(); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); input.blur(); });
  field.append(input);
  bar.append(field);
  return (state.bar = bar);
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
  if (!state.sources) { el.replaceChildren(); return; }
  if (state.loadError) {
    el.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: state.loadError }));
    return;
  }
  const bar = searchBar();
  if (!state.box || state.box.parentNode !== el || bar.parentNode !== el) {
    state.box = document.createElement("div");
    el.replaceChildren(bar, state.box);
  }
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
    box.append(Object.assign(document.createElement("p"), { className: "empty",
      textContent: searching ? "No sources match." : "No sources. Tap Manage, then Sources." }));
  }
}

function decorate(li, source, backend) {
  li.classList.add("source-row");
  li.dataset.key = source.key;
  const loading = state.loading.has(source.key);
  li.classList.toggle("is-loading", loading);
  // a source shows as failed only once a load has actually failed, not while one is under way
  if (source.error && !loading) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
  // F16a: a source only its own app can read (an encrypted GBox one) says so under its name; its page says why.
  if (source.unsupported && !source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
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
    showMenu(li, [{ label: "Copy URL", onClick: () => copyText(li.dataset.url) }], { x: e.clientX });
  });
  let start = null;   // the pointer that may become a swipe
  let swiped = false; // the click that ends a swipe opens nothing
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = ul.querySelector(".source-row.armed");
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
    const job = getBackend().refreshSources(run.onEach, { filter, signal: run.signal });
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
  }
}
