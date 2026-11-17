// Sources tab, after Cydia's (docs/cydia.md "Sources tab"): one row per source, sorted by name, with its
// CydiaIcon.png, name, URL and (Cydian's own addition) how many packages it has for this device's architecture.
// Nav bar: Refresh (HUD, refetch every source) and Edit; in edit mode Add (an alert that checks the repo before
// saving it) and Done, and a red minus per row. A left swipe on a row shows Delete too. The list lives on the
// device and comes through the backend (core/sources.js sourceCalls), so the app runs this file unchanged.
import { grouped, plain } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { format } from "../router.js";
import { getBackend } from "../backend.js";
import { displayName, sourceIconUrl } from "../core/sources.js";

export const title = "Sources";

const state = {
  sources: null,   // the list as last loaded, sorted
  body: null,      // the root page's scroller
  editing: false,
  busy: false,     // a refresh or an add is running
  left: null,      // the nav bar's buttons, found on first tap
  right: null,
};

const byKey = (key) => state.sources?.find((s) => s.key === key);

export function nav(route, ctx) {
  if (route.path.length) {
    const s = byKey(route.path[0]);
    return { title: s ? displayName(s) : "Source" };
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

export function render(el, route) {
  if (route.path.length) {
    renderDetail(el, route.path[0]);
    return;
  }
  state.body = el;
  draw();
  load();
}

async function load() {
  try {
    state.sources = await getBackend().sources();
  } catch (e) {
    state.sources = [];
    state.loadError = e.message;
  }
  draw();
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
  const list = state.sources;
  const ul = plain([{
    header: "Individual Sources",
    rows: list.map((s) => ({
      label: displayName(s),
      subtitle: s.uri,
      icon: { text: displayName(s)[0]?.toUpperCase() ?? "?" },
      badge: typeof s.count === "number" ? s.count.toLocaleString() : undefined,
      href: format({ tab: "sources", path: [s.key] }),
    })),
  }]);
  ul.classList.toggle("editing", state.editing);
  const cells = ul.querySelectorAll(":scope > .cell");
  list.forEach((s, i) => decorate(cells[i], s, backend));
  attachRowGestures(ul);
  el.replaceChildren(ul);
  if (!list.length) {
    el.append(Object.assign(document.createElement("p"), { className: "empty", textContent: "No sources. Tap Edit, then Add." }));
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
  img.onerror = () => img.remove();
  img.src = backend.assetUrl ? backend.assetUrl(sourceIconUrl(source)) : sourceIconUrl(source);
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
    li.remove();
    if (!state.sources.length) draw();
  }, 250);
}

// ---- Refresh and Add -------------------------------------------------------------------------------------

async function refresh(ctx) {
  if (state.busy) return;
  state.busy = true;
  const hide = ctx.showHUD("Reloading Data");
  try {
    await getBackend().refreshSources();
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

// ---- a source's page: Cydia opens its Sections; until that lands, what we know about it --------------------

async function renderDetail(el, key) {
  if (!state.sources) await load();
  const s = byKey(key);
  if (!s) {
    el.append(grouped([{ rows: [{ label: "Source not found" }], footer: key }]));
    return;
  }
  const rows = [
    { label: "Name", detail: displayName(s) },
    { label: "URL", detail: s.uri },
    { label: "Distribution", detail: s.dist },
  ];
  if (s.components?.length) rows.push({ label: "Components", detail: s.components.join(" ") });
  rows.push({ label: "Packages", detail: typeof s.count === "number" ? s.count.toLocaleString() : "—" });
  if (s.updated) rows.push({ label: "Updated", detail: new Date(s.updated).toLocaleString() });
  el.append(grouped([{ header: "Source Information", rows, footer: s.error || undefined }]));
}
