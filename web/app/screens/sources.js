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
import { showMenu, longPress, copyText } from "../nav/menu.js";
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
  query: "",        // F19: the search box's text
  bar: null,        // F19: the search box, kept across redraws so typing keeps its focus
  box: null,        // F19: where the list goes, under the search box
};

const byKey = (key) => state.sources?.find((s) => s.key === key);

async function addFromClipboard(ctx, button) {
  // iOS's Paste bubble takes the touch, so the pointerup that would clear the held look never comes: clear it here.
  button.classList.remove("is-pressed");
  button.textContent = "Paste";
  button.classList.add("paste-wait");
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { /* refused, or nothing to read */ }
  button.textContent = "Add";
  button.classList.remove("paste-wait", "is-pressed");
  const url = cleanSourceUrl(text);
  manage.addSource(ctx, url ? { url } : null);
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
      // Add: asks iOS for the clipboard (its Paste bubble); while that waits the button turns blue and reads Paste,
      // so it's clear the bubble wants a tap. Then the Enter APT URL alert, filled with a copied source URL.
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
// Refresh's HUD, so a first visit shows names, icons and counts without a tap.
async function firstLoad(ctx) {
  if (state.busy) return;
  state.busy = true;
  let hide = () => {};
  try {
    const done = await loadNeverLoaded(getBackend(), state.sources, settings.deviceType(), {
      tried: state.tried,
      begin: () => (hide = ctx?.showHUD ? ctx.showHUD("Reloading Data") : () => {}),
    });
    if (done) {
      state.sources = await getBackend().sources();
      draw();
    }
  } catch {
    // a failed first load leaves the rows as they were; Refresh shows the error
  } finally {
    linger(hide);
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
  if (source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
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
    await getBackend().refreshSources(undefined, { filter: sourceFilter(settings.deviceType()) }); // F41: only what's shown
    state.sources = await getBackend().sources();
    draw();
  } catch (e) {
    hide();
    await showAlert({ title: "Error", message: e.message, buttons: ["OK"] });
  } finally {
    linger(hide);
    state.busy = false;
  }
}
