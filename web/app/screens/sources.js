// Sources tab, after Cydia's (docs/cydia.md "Sources tab"): one row per source, sorted by name, with its
// CydiaIcon.png, name, URL and (Cydian's own addition) how many packages it has for this device's architecture.
// Nav bar: Refresh (HUD, refetch every source) and Edit; in edit mode Add (an alert that checks the repo before
// saving it) and Done, and a red minus per row. A left swipe on a row shows Delete too. The list lives on the
// device and comes through the backend (core/sources.js sourceCalls), so the app runs this file unchanged.
// Above the sources, Cydia's "All Sources" row; a source (or All Sources) opens its Sections, and everything
// below that is screens/browse.js.
import { plain } from "../nav/ui.js";
import * as browse from "./browse.js";
import { showAlert } from "../nav/alert.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { displayName, sourceIcons, sourceSubtitle, sourcesFor, sourceFilter, loadNeverLoaded } from "../core/sources.js";
import { settings } from "./settings.js";

export const title = "Sources";

const state = {
  sources: null,   // the list as last loaded, sorted
  body: null,      // the root page's scroller
  editing: false,
  busy: false,     // a refresh or an add is running
  left: null,      // the nav bar's buttons, found on first tap
  right: null,
  tried: new Set(), // F43: keys first-loaded this session (core/sources.js loadNeverLoaded)
};

const byKey = (key) => state.sources?.find((s) => s.key === key);

export function nav(route, ctx) {
  if (route.path.length) {
    return browse.nav(route, (key) => { const s = byKey(key); return s ? displayName(s) : null; });
  }
  return {
    title: "Sources", style: "plain",
    left: { label: "Refresh", onClick: (e) => { grabButtons(e); state.editing ? addSource(ctx) : refresh(ctx); } },
    right: { label: "Edit", onClick: (e) => { grabButtons(e); setEditing(!state.editing); } },
  };
}

function grabButtons(e) {
  const item = e.currentTarget.closest(".nav-item");
  state.left = item.querySelector(".nav-left .bar-button");
  state.right = item.querySelector(".nav-right .bar-button");
}

// Device (F37) changes which sources show: redraw the list if it is on screen.
settings.onChange((key) => { if (key === "device" && state.body?.isConnected) draw(); });

export function render(el, route, ctx) {
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
    hide();
    state.busy = false;
  }
}

// ---- the list --------------------------------------------------------------------------------------------

function draw() {
  const el = state.body;
  if (!el) return;
  if (!state.sources) { el.replaceChildren(); return; }
  if (state.loadError) {
    el.replaceChildren(Object.assign(document.createElement("p"), { className: "empty", textContent: state.loadError }));
    return;
  }
  const backend = getBackend();
  // F37: Not Jailbroken shows AltStore sources only; the APT ones stay in the list, out of sight.
  const { shown: list, hidden } = sourcesFor(state.sources, settings.deviceType());
  const ul = plain([{
    rows: [{
      label: "All Sources",
      subtitle: "combined package list for below sources",
      href: format({ tab: "sources", path: ["*"] }),
    }],
  }, {
    header: "Individual Sources",
    rows: list.map((s) => ({
      label: displayName(s),
      subtitle: sourceSubtitle(s), // F44: github.com/<user>/<repo> for GitHub-hosted sources
      icon: { text: displayName(s)[0]?.toUpperCase() ?? "?" },
      badge: typeof s.count === "number" ? s.count.toLocaleString() : undefined,
      href: format({ tab: "sources", path: [s.key] }),
    })),
  }]);
  ul.classList.toggle("editing", state.editing);
  const cells = ul.querySelectorAll(":scope > .cell");
  cells[0].classList.add("all-sources-row");
  cells[0].querySelector(".cell-inner").prepend(Object.assign(document.createElement("span"), { className: "folder" }));
  list.forEach((s, i) => decorate(cells[i + 1], s, backend));
  attachRowGestures(ul);
  el.replaceChildren(ul);
  if (!list.length) {
    el.append(Object.assign(document.createElement("p"), { className: "empty", textContent: "No sources. Tap Edit, then Add." }));
  }
  if (hidden) {
    const n = `${hidden} APT ${hidden === 1 ? "source is" : "sources are"}`;
    el.append(Object.assign(document.createElement("p"), { className: "group-footer sources-hidden",
      textContent: `${n} hidden: they list tweaks and themes for jailbroken iPhones. Jailbroken? Settings > Device.` }));
  }
}

function decorate(li, source, backend) {
  li.classList.add("source-row");
  li.dataset.key = source.key;
  if (source.error) li.querySelector(".cell-subtitle")?.classList.add("cell-error");
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
}

function arm(li, on) {
  for (const other of li.parentNode.querySelectorAll(".source-row.armed")) if (other !== li) other.classList.remove("armed");
  li.classList.toggle("armed", on);
}

// While editing, or while a row shows Delete, a tap on a row doesn't open it: it only puts the Delete away.
// A left swipe on a row shows its Delete; a right swipe hides it.
function attachRowGestures(ul) {
  let start = null;   // the pointer that may become a swipe
  let swiped = false; // the click that ends a swipe opens nothing
  ul.addEventListener("click", (e) => {
    if (e.target.closest(".del-toggle, .del-confirm")) return;
    const armed = ul.querySelector(".source-row.armed");
    if (!state.editing && !armed && !swiped) return;
    e.preventDefault();
    e.stopPropagation();
    if (armed && !swiped) armed.classList.remove("armed");
    swiped = false;
  }, true);

  ul.addEventListener("pointerdown", (e) => {
    const li = e.target.closest(".source-row");
    swiped = false;
    start = li && !state.editing && !e.target.closest(".del-confirm") ? { li, x: e.clientX, y: e.clientY } : null;
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

function setEditing(on) {
  state.editing = on;
  state.body?.querySelector(".table")?.classList.toggle("editing", on);
  for (const li of state.body?.querySelectorAll(".source-row.armed") ?? []) li.classList.remove("armed");
  if (state.right) {
    state.right.textContent = on ? "Done" : "Edit";
    state.right.classList.toggle("done", on);
  }
  if (state.left) state.left.textContent = on ? "Add" : "Refresh";
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

// UITableView's delete: the row goes and everything under it slides up into its place. FLIP, by transform only:
// remove the row, then start everything that was below it one row lower and let it ease up.
function collapse(li) {
  const h = li.getBoundingClientRect().height;
  const below = [];
  for (let n = li; n && !n.classList?.contains("page-body"); n = n.parentElement) {
    for (let s = n.nextElementSibling; s; s = s.nextElementSibling) below.push(s);
  }
  li.remove();
  for (const el of below) {
    el.animate([{ transform: `translateY(${h}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.25,.1,.25,1)" });
  }
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
    hide();
    state.busy = false;
  }
}

async function addSource(ctx) {
  if (state.busy) return;
  const { index, value } = await showAlert({
    title: "Enter APT URL",
    message: "Or an AltStore source (.json) for apps.",
    input: { placeholder: "https://", value: "https://", type: "url" },
    buttons: ["Cancel", "Add Source"],
    cancel: 0,
  });
  if (index !== 1) return;
  state.busy = true;
  const hide = ctx.showHUD("Verifying URL");
  let error = null;
  try {
    await getBackend().addSource(value);
    state.sources = await getBackend().sources();
    draw();
  } catch (e) {
    error = e;
  } finally {
    hide();
    state.busy = false;
  }
  if (error) await showAlert({ title: error.title || "Verification Error", message: error.message, buttons: ["OK"] });
}
