// Sources tab, after Cydia's (docs/cydia.md "Sources tab"): one row per source, sorted by name, with its
// CydiaIcon.png, name, URL and (Cydian's own addition) how many packages it has for this device's architecture.
// Nav bar: Refresh (HUD, refetch every source) and Manage (F45, screens/manage.js: the edit list with Add, delete
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
import { settings } from "./settings.js";
import * as manage from "./manage.js";
import { orderSources, loadOrder, filterSources } from "../core/sourcelist.js";
import { healthOf } from "../core/health.js";
import { recommendedSeen, jailbreakName } from "../core/recommended.js";
import { builtinFirst, isBuiltin } from "../core/essential.js";
import { lockMark } from "../nav/lock.js";

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

// Add: asks iOS for the clipboard. While iOS's Paste bubble is up the button turns blue and reads Type: tapping it
// (or anywhere but another button) dismisses the bubble and opens the Enter APT URL alert to type one in.
// Touch-down on the website: Safari reads the clipboard only straight from the tap (no timer between), and nothing
// paints while the bubble is up, so Type goes on now, painted before the release opens the bubble.
function showType(button) {
  if (globalThis.cydianNative) return; // the app reads UIPasteboard: no bubble
  button.textContent = "Type";
  button.classList.add("done");
  setTimeout(() => button.classList.remove("is-pressed")); // app.js presses it after this listener
  button.addEventListener("pointercancel", () => { button.textContent = "Add"; button.classList.remove("done"); }, { once: true });
}

// `native` and `open` are for tests (screens/addsource.test.js): the bridge, and manage.addSource.
export async function addFromClipboard(ctx, button, { native = globalThis.cydianNative, open = manage.addSource } = {}) {
  if (native) return addFromPasteboard(ctx, button, native, open);
  reset(button);
  button.textContent = "Type";
  button.classList.add("done"); // the blue Done look (sources.css)
  let elsewhere = false; // a touch on another button while the bubble was up: that button's tap wins
  const watch = (e) => { const b = e.target.closest?.(".bar-button, .tab"); if (b && b !== button) elsewhere = true; };
  document.addEventListener("pointerdown", watch, true);
  // readText blocks WebKit's main thread while the Paste bubble is up, so nothing set here paints: Safari reads only
  // straight from the tap (no timer between), so showType put Type on at touch-down instead.
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { /* dismissed: type it in */ }
  document.removeEventListener("pointerdown", watch, true);
  button.textContent = "Add";
  button.classList.remove("done");
  reset(button);
  if (elsewhere || !button.isConnected || !/^#\/sources\/?$/.test(location.hash)) return;
  const url = cleanSourceUrl(text);
  manage.addSource(ctx, url ? { url } : null);
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
      // Add: the clipboard (the app: UIPasteboard; the website: iOS's Paste bubble, the button blue and reading Type
      // while it waits). Then the Enter APT URL alert, filled with a copied source URL.
      // F146: the app has no Type switch at all (no onPress): Add opens Enter APT URL and Cydian reads the clipboard.
      { label: "Add", ...(globalThis.cydianNative ? {} : { onPress: (e) => showType(e.currentTarget) }),
        onClick: (e) => addFromClipboard(ctx, e.currentTarget) },
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
// Refresh's HUD, so a first visit shows names, icons and counts without a tap.
async function firstLoad(ctx) {
  if (state.busy) return;
  state.busy = true;
  let hide = () => {};
  try {
    let each = () => {};
    const done = await loadNeverLoaded(getBackend(), state.sources, settings.deviceType(), {
      tried: state.tried,
      begin: (keys) => { each = markLoading(ctx, [...(keys ?? [])]); hide = ctx?.showHUD ? ctx.showHUD("Reloading Data") : () => {}; },
      onEach: (d) => each(d),
    });
    if (done) {
      state.sources = await getBackend().sources();
      draw();
    }
  } catch {
    // a failed first load leaves the rows as they were; Refresh shows the error
  } finally {
    clearLoading(ctx);
    linger(hide);
    state.busy = false;
  }
}

// Loading marks: the rows of `keys` spin and the Sources tab's badge spins until each answers (onEach), as
// Cydia does. Returns onEach for refreshSources.
// globalThis.cydianRefreshing: how many sources are refreshing now, for Home's tile (with the cydian:refreshing event).
function announce() {
  globalThis.cydianRefreshing = state.loading.size;
  globalThis.dispatchEvent?.(new Event("cydian:refreshing"));
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
// open, with the Sources tab's red spinning badge and the rows spinning if Sources is on screen. No HUD.
export async function refreshInBackground(ctx) {
  if (state.busy) return;
  state.busy = true;
  try {
    state.sources = await getBackend().sources();
    const filter = sourceFilter(settings.deviceType());
    const onEach = markLoading(ctx, state.sources.filter(filter ?? (() => true)).map((x) => x.key));
    await getBackend().refreshSources(onEach, { filter });
    state.sources = await getBackend().sources();
    if (state.box?.isConnected) draw();
  } catch {
    // a failed refresh shows per source (its row) once it has failed
  } finally {
    clearLoading(ctx);
    state.busy = false;
  }
}

// The HUD stays exactly as long as the loading, then a second more before its usual fade.
const linger = (hide) => setTimeout(hide, 1000);

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
    href: format({ tab: "sources", path: [manage.SEGMENT] }) }; // Manage: Recommended is on it
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
  // F37: Not Jailbroken shows AltStore sources only; the APT ones stay in the list, out of sight.
  // F45: in the order set in Manage > Sources (none set: by name).
  // F72: Cydian's own source (built in) stays first whatever the order.
  const { shown, hidden } = sourcesFor(builtinFirst(orderSources(state.sources, loadOrder())), settings.deviceType());
  const searching = Boolean(state.query.trim());
  const list = filterSources(shown, state.query, displayName);
  const rec = searching ? null : recommendedRow();
  const top = searching ? [] : [{
    label: "All Sources",
    subtitle: "combined package list for below sources",
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
  if (hidden && !searching) {
    const n = `${hidden} APT ${hidden === 1 ? "source is" : "sources are"}`;
    box.append(Object.assign(document.createElement("p"), { className: "group-footer sources-hidden",
      textContent: `${n} hidden: they list tweaks and themes for jailbroken iPhones. Jailbroken? Settings > Device.` }));
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
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => img.classList.add("loaded");
  // Cydia's <base>CydiaIcon.png first, then the repo's top level for dist repos (sourceIconUrls).
  // An AltStore source (F9) names its icon in its JSON. A GitHub-hosted source without one gets its owner's
  // avatar (F44, core/sources.js sourceIcons).
  const urls = sourceIcons(source).map((u) => (backend.assetUrl ? backend.assetUrl(u) : u));
  img.onerror = () => (urls.length ? (img.src = urls.shift()) : img.remove());
  img.src = urls.shift();
  li.querySelector(".cell-icon").append(img);
  li.dataset.url = source.uri; // Copy URL (hold the row)
  // F72: Cydian's own source is built in: a lock after its name, and no Delete (a swipe arms nothing).
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

async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  const hide = ctx.showHUD("Reloading Data");
  try {
    const filter = sourceFilter(settings.deviceType());
    const onEach = markLoading(ctx, (state.sources ?? []).filter(filter ?? (() => true)).map((x) => x.key));
    await getBackend().refreshSources(onEach, { filter }); // F41: only what's shown
    state.sources = await getBackend().sources();
    draw();
  } catch (e) {
    hide();
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    clearLoading(ctx);
    linger(hide);
    state.busy = false;
  }
}
