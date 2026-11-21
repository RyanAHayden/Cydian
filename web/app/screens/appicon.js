// F329: your own app icon (Settings > Theme > App Icon > Light / Dark, the grid's "Your Icons" group). The jailbreak
// app only for now: the Lite build, whose signed bundle can't gain icons, is its own task.
//
//   Add            a file input (iOS offers Photo Library, Take Photo and Choose File: PNG, JPEG, HEIC), then
//                  iOS 6's Move and Scale: the picture behind black bars, the icon's rounded mask, a small Home Screen
//                  preview between Cancel and Choose. Choose hands the picture and the square to the shell, which
//                  crops it to 1024 px.
//   Your Icons     the pictures the shell keeps (app.icon.list), each a cell like the theme icons: a tap picks it for
//                  this mode, a swipe left shows Delete.
//
// Shell calls (native/Sources/AppIcon.swift OwnIcons):
//   app.icon.list                     -> {icons: [{name, label}]}
//   app.icon.add {data, crop, label}  -> {name, icons}   data: the picture's bytes (base64); crop: {x, y, size,
//                                                        width, height} in its px (cropRect, and its size)
//   app.icon.remove {name}            -> {icons}
//   app.icon.decode {data}            -> {jpeg}          a picture the web view can't draw (HEIC on iOS 15), as JPEG
// A pick is applied like any icon: settings lightIcon / darkIcon take the name (core/settings.js isOwnIcon) and
// appicon.js tellIcon sends it in app.icon; the shell shows it as appicon/<name>.png.
// SPDX-License-Identifier: GPL-3.0-or-later
import { nativeBridge, hasNativeCall } from "../native.js";
import { isOwnIcon } from "../core/settings.js";
import { swipeDecide } from "../nav/rowswipe.js";
import { NAME } from "../brand.js";

export const OUT = 1024; // px: the stored picture (the shell draws it: OwnIcons.add)
export const ZOOM = 4;   // Move and Scale zooms in to 4x the smallest scale that fills the square

// ---- Crop maths (pure) ----------------------------------------------------------------------------------------
// A crop: the picture (w x h px) drawn at scale s (screen px per picture px) with its top left corner at (tx, ty)
// from the square's top left corner; the square is `side` screen px. The picture always covers the square, as
// iOS's Move and Scale keeps it: s never under `min` (the short side fills it), never over `max`.
export function cropStart(w, h, side) {
  const min = side / Math.min(w, h);
  return clampCrop({ w, h, side, min, max: min * ZOOM, s: min, tx: (side - w * min) / 2, ty: (side - h * min) / 2 });
}

export function clampCrop(c) {
  const s = Math.min(c.max, Math.max(c.min, c.s));
  const lim = (t, len) => Math.min(0, Math.max(c.side - len * s, t));
  return { ...c, s, tx: lim(c.tx, c.w), ty: lim(c.ty, c.h) };
}

export const panCrop = (c, dx, dy) => clampCrop({ ...c, tx: c.tx + dx, ty: c.ty + dy });

// Scale by `factor` about (px, py) in the square's coordinates: the picture's point under it stays under it.
export function zoomCrop(c, factor, px, py) {
  const s = Math.min(c.max, Math.max(c.min, c.s * factor));
  const ix = (px - c.tx) / c.s, iy = (py - c.ty) / c.s;
  return clampCrop({ ...c, s, tx: px - ix * s, ty: py - iy * s });
}

// The square in picture px: drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT). Kept inside the picture: iOS 15's
// WebKit draws nothing at all for a source rect that passes its edge, even by a rounding error (checked on the
// iPhone 7 with a square picture, where side / s came out a hair over its width).
export function cropRect(c) {
  const size = Math.min(c.side / c.s, c.w, c.h);
  const fit = (v, len) => Math.min(len - size, Math.max(0, v));
  return { sx: fit(-c.tx / c.s, c.w), sy: fit(-c.ty / c.s, c.h), size };
}

// ---- The stored list (pure) -----------------------------------------------------------------------------------
// The shell's answer, kept to well-formed entries in its order.
export function readList(raw) {
  const icons = Array.isArray(raw?.icons) ? raw.icons : [];
  return icons.filter((i) => isOwnIcon(i?.name)).map((i) => ({ name: i.name, label: String(i.label ?? "").slice(0, 24) || "Icon" }));
}

// The label under a new picture: its file's name without the extension, unless that says nothing (iOS hands Photos'
// pictures over as image.jpeg): then "Icon <n>", the first number not in use.
export function labelFor(fileName, list = []) {
  const stem = String(fileName ?? "").replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ").trim().slice(0, 24);
  if (stem && !/^(image|photo|img \d+|file)$/i.test(stem)) return stem;
  const used = new Set(list.map((i) => i.label));
  let n = list.length + 1;
  for (let k = 1; k <= list.length + 1; k++) if (!used.has(`Icon ${k}`)) { n = k; break; }
  return `Icon ${n}`;
}

// The icon settings that pick `name`: deleting it puts them back on their theme's icon.
export const picksOf = (name, get) => ["lightIcon", "darkIcon"].filter((k) => get(k) === name);

// The icon settings picking an own icon the shell no longer keeps (its list): they go back to the theme's icon.
export const missingPicks = (list, get) =>
  ["lightIcon", "darkIcon"].filter((k) => isOwnIcon(get(k)) && !list.some((i) => i.name === get(k)));
export function dropMissing(store, list) {
  for (const k of missingPicks(list, (x) => store.get(x))) store.set(k, "theme");
}

// Where Add is offered: the jailbreak app with a bridge. (The Lite build can't apply one yet.)
export const ownIconsOffered = (mode, native = nativeBridge()) => mode === "jailbreak" && hasNativeCall(native);

// ---- Shell calls ----------------------------------------------------------------------------------------------
let cache = []; // the last list, so a redraw (a pick) draws Your Icons at once
export const cachedIcons = () => cache;
export const ownLabel = (name) => cache.find((i) => i.name === name)?.label ?? "Your Icon";

async function call(method, params = {}, native = nativeBridge()) {
  if (!hasNativeCall(native)) throw new Error("no bridge");
  return native.call(method, params);
}
export async function loadIcons(native) {
  cache = readList(await call("app.icon.list", {}, native));
  return cache;
}
async function addIcon(data, crop, label) {
  const r = await call("app.icon.add", { data, crop, label });
  cache = readList(r);
  return r?.name;
}
async function removeIcon(name) {
  cache = readList(await call("app.icon.remove", { name }));
  return cache;
}

// ---- Your Icons group -----------------------------------------------------------------------------------------
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// The group for Theme > App Icon > Light / Dark (screens/settings.js iconPage). `key` lightIcon or darkIcon, `now` the
// icon that mode has, `store` the settings.
export function ownIconsGroup({ key, now, store }) {
  const group = make("div", "group own-icons");
  group.dataset.key = "own-icons";
  const head = make("h2", "group-header", "Your Icons");
  const table = make("div", "table grouped icon-table");
  const grid = make("div", "icon-grid");
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Your Icons");
  table.append(grid);
  group.append(head, table, make("p", "group-footer", "Add a picture from Photos or Files. Swipe left on one to delete it."));

  const draw = (list) => {
    const cells = list.map((i) => {
      const b = make("button", "icon-cell own-icon-cell");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(i.name === now));
      b.dataset.icon = i.name;
      const img = make("img");
      img.alt = "";
      img.src = `appicon/${i.name}.png`;
      const del = make("span", "own-icon-delete", "Delete");
      del.setAttribute("role", "button");
      b.append(img, make("span", "icon-cell-label", i.label), del);
      b.addEventListener("click", (e) => {
        if (b.classList.contains("is-deleting")) {
          e.stopPropagation();
          if (e.target === del) remove(i.name, b);
          else b.classList.remove("is-deleting");
          return;
        }
        if (store.get(key) !== i.name) store.set(key, i.name);
      });
      swipeToDelete(b, grid);
      return b;
    });
    grid.replaceChildren(...cells, addTile(key, store));
  };

  async function remove(name, cell) {
    const before = new Map([...grid.children].map((c) => [c, c.getBoundingClientRect()]));
    try {
      await removeIcon(name);
    } catch {
      cell.classList.remove("is-deleting");
      return;
    }
    for (const k of picksOf(name, (x) => store.get(x))) store.set(k, "theme");
    if (!grid.isConnected) return;
    cell.remove();
    slideCells(grid, before);
  }

  draw(cache);
  loadIcons().then((list) => {
    dropMissing(store, list);
    if (grid.isConnected) draw(list);
  }).catch(() => {});
  return group;
}

// AGENTS rule (size changes slide): the cells after a deleted one slide into its place (FLIP, transform only).
function slideCells(grid, before) {
  for (const c of grid.children) {
    const a = before.get(c);
    if (!a) continue;
    const b = c.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    c.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: "ease" });
  }
}

// A swipe left on a cell shows its Delete button (iOS 6's red one); a tap anywhere else in the grid hides it.
function swipeToDelete(cell, grid) {
  let x0 = 0, y0 = 0, decided = "";
  cell.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; decided = "";
  }, { passive: true });
  cell.addEventListener("touchmove", (e) => {
    if (decided) return;
    const t = e.touches[0];
    const d = swipeDecide(t.clientX - x0, t.clientY - y0);
    if (d === "wait") return;
    decided = d;
    if (d === "swipe") {
      for (const c of grid.querySelectorAll(".is-deleting")) if (c !== cell) c.classList.remove("is-deleting");
      cell.classList.add("is-deleting");
    }
  }, { passive: true });
}

function addTile(key, store) {
  const tile = make("label", "icon-cell own-icon-add");
  const box = make("span", "own-icon-plus");
  box.setAttribute("aria-hidden", "true");
  const input = make("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/heic,image/heif";
  input.className = "own-icon-file";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) openCrop(file, { key, store });
  });
  tile.append(input, box, make("span", "icon-cell-label", "Add"));
  return tile;
}

// ---- Move and Scale -------------------------------------------------------------------------------------------
const base64Of = (buf) => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

function loadImage(src) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth && img.naturalHeight ? ok(img) : fail(new Error("empty")));
    img.onerror = () => fail(new Error("can't draw"));
    img.src = src;
  });
}

// The picture as an <img> and its bytes (base64), the same picture: the web view draws PNG and JPEG (and HEIC from
// iOS 17); otherwise the shell converts it to JPEG. The shell crops those bytes (app.icon.add): drawing the <img>
// onto a canvas drew nothing for some pictures on the iPhone 7 (iOS 15), so the page never rasterises it.
async function pictureOf(file) {
  const data = base64Of(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  try {
    return { img: await loadImage(url), data };
  } catch {
    URL.revokeObjectURL(url);
    const r = await call("app.icon.decode", { data });
    if (!r?.jpeg) throw new Error("can't open");
    return { img: await loadImage(`data:image/jpeg;base64,${r.jpeg}`), data: r.jpeg };
  }
}

export async function openCrop(file, { key, store }) {
  let img, data;
  try {
    ({ img, data } = await pictureOf(file));
  } catch {
    const { showAlert } = await import("../nav/alert.js");
    showAlert({ title: "Can't Open Picture", message: "Pick a PNG, JPEG or HEIC picture.", buttons: ["OK"] });
    return;
  }
  const label = labelFor(file.name, cache);
  const screen = make("div", "crop-screen");
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-label", "Move and Scale");
  const stage = make("div", "crop-stage");
  img.className = "crop-photo";
  img.alt = "";
  img.draggable = false;
  stage.append(img);
  const mask = make("div", "crop-mask");
  const title = make("div", "crop-title", "Move and Scale");
  const bar = make("div", "crop-bar");
  const cancel = make("button", "crop-button", "Cancel");
  const choose = make("button", "crop-button crop-choose", "Choose");
  cancel.type = choose.type = "button";
  // The Home Screen preview: the same picture in a 44 px rounded box, moved and scaled with it (transform only)
  const prev = make("div", "crop-preview");
  const box = make("div", "crop-preview-icon");
  const thumb = make("img", "crop-preview-photo");
  thumb.alt = "";
  thumb.src = img.src;
  box.append(thumb);
  prev.append(box, make("span", "crop-preview-label", NAME));
  bar.append(cancel, prev, choose);
  screen.append(stage, mask, title, bar);
  document.body.append(screen);

  // left/top: the square's corner in the screen's own coordinates (the screen may be mid-slide when measured)
  let c = null, left = 0, top = 0;
  const origin = () => screen.getBoundingClientRect();
  const layout = () => {
    const r = mask.getBoundingClientRect(), o = origin();
    left = r.left - o.left; top = r.top - o.top;
    c = c ? clampCrop({ ...c, side: r.width, min: r.width / Math.min(c.w, c.h), max: (r.width / Math.min(c.w, c.h)) * ZOOM, s: c.s * (r.width / c.side), tx: c.tx * (r.width / c.side), ty: c.ty * (r.width / c.side) })
      : cropStart(img.naturalWidth, img.naturalHeight, r.width);
    paint();
  };
  const paint = () => {
    img.style.transform = `translate(${left + c.tx}px, ${top + c.ty}px) scale(${c.s})`;
    const { sx, sy, size } = cropRect(c);
    const k = (box.clientWidth || 44) / size;
    thumb.style.transform = `scale(${k}) translate(${-sx}px, ${-sy}px)`;
  };

  // One finger moves, two scale about their middle (pointer events; the stage takes every touch).
  const pts = new Map();
  let last = null, o = { left: 0, top: 0 };
  const mid = () => {
    const [a, b] = [...pts.values()].map((p) => ({ x: p.x - o.left, y: p.y - o.top }));
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) } : { x: a.x, y: a.y, d: 0 };
  };
  const down = (e) => {
    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);
    if (!pts.size) o = origin();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = mid();
  };
  const move = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = mid();
    if (last) {
      c = panCrop(c, m.x - last.x, m.y - last.y);
      if (m.d && last.d) c = zoomCrop(c, m.d / last.d, m.x - left, m.y - top);
      paint();
    }
    last = m;
  };
  const up = (e) => {
    pts.delete(e.pointerId);
    last = pts.size ? mid() : null;
  };
  for (const el of [stage, mask]) {
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  // Two-finger pinch over the mask on desktop trackpads arrives as ctrl+wheel; a wheel alone zooms too.
  screen.addEventListener("wheel", (e) => {
    e.preventDefault();
    const w = origin();
    c = zoomCrop(c, Math.exp(-e.deltaY / 300), e.clientX - w.left - left, e.clientY - w.top - top);
    paint();
  }, { passive: false });

  const close = () => {
    removeEventListener("resize", layout);
    screen.classList.remove("is-open");
    let gone = false;
    const done = () => { if (!gone) { gone = true; screen.remove(); } };
    screen.addEventListener("transitionend", done, { once: true });
    setTimeout(done, 450);
  };
  cancel.addEventListener("click", close);
  choose.addEventListener("click", async () => {
    choose.disabled = cancel.disabled = true;
    const { sx, sy, size } = cropRect(c);
    try {
      const name = await addIcon(data, { x: sx, y: sy, size, width: c.w, height: c.h }, label);
      if (isOwnIcon(name)) store.set(key, name);
      close();
    } catch {
      choose.disabled = cancel.disabled = false;
      const { showAlert } = await import("../nav/alert.js");
      showAlert({ title: "Can't Save Icon", message: "The picture couldn't be kept. Try again.", buttons: ["OK"] });
    }
  });
  addEventListener("resize", layout);
  layout();
  requestAnimationFrame(() => requestAnimationFrame(() => screen.classList.add("is-open"))); // slides up, as iOS presents it
}
