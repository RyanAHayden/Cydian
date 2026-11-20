// F288: the "Inject Tweaks" group of a sign options sheet (the sideload app's Custom Install sheet and My IPAs' Sign
// Options; the website's IPA page): the tweaks the user added for this app, a row each (tap: Remove), then an
// "Add Tweak…" row that picks .dylib, .deb or zipped .framework files. iOS 6 grouped table, as the sheet's other
// groups. The files are kept per app (by bundle ID) in this browser's IndexedDB, so the next sign of the same app
// (a re-sign, an update, the website's Install) injects them again; the app's own Re-sign All keeps them in its
// signed record (native/sign/Tweaks.swift).
//
//   const g = tweaksGroup({ bundleId })     g.el (the group), await g.ready (the saved ones drawn), g.items()
//   await g.save()                          keeps the current list for bundleId (Install / Save call it)
//   await g.prepared()                      core/tweaks.js prepareTweaks of the list, or null; throws with words
//   await savedTweaks(bundleId)             [{ name, data }] kept for that app
//   await preparedFor(bundleId)             the kept ones, prepared, or null (the website's Install)
// SPDX-License-Identifier: GPL-3.0-or-later
import { el } from "../nav/ui.js";
import { showAlert } from "../nav/alert.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { openIpaStore, memoryIpaStore } from "../core/myipas.js";
import { prepareTweaks, tweakProblem, tweakKind, TWEAK_ACCEPT } from "../core/tweaks.js";

const DB = "ifizbox-tweaks";
let storeP = null;
export function tweakStore() {
  storeP ??= openIpaStore({ name: DB }).catch(() => memoryIpaStore()); // no IndexedDB: kept until the page closes
  return storeP;
}

const asItems = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && x.data) : []);

export async function savedTweaks(bundleId, { store = tweakStore } = {}) {
  if (!bundleId) return [];
  try { return asItems(await (await store()).get(bundleId)); } catch { return []; }
}

export async function saveTweaks(bundleId, items, { store = tweakStore } = {}) {
  if (!bundleId) return;
  const s = await store();
  if (items.length) await s.put(bundleId, items.map((x) => ({ name: x.name, data: new Uint8Array(x.data) })));
  else await s.remove(bundleId);
}

// Prepared, or null for none; a problem (CydiaSubstrate missing, a bad file) throws an Error with words.
export function prepareItems(items) {
  if (!items.length) return null;
  const p = prepareTweaks(items);
  const why = tweakProblem(p);
  if (why) throw new Error(why);
  return p;
}

export async function preparedFor(bundleId, opts) { return prepareItems(await savedTweaks(bundleId, opts)); }

const sizeText = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const FOOTER = "Add .dylib, .deb or zipped .framework tweaks: they go into the app's Frameworks and load with it. "
  + "A tweak that uses CydiaSubstrate needs ElleKit's .deb too. Kept for this app when it's signed again.";

let styled = false;
function style() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../tweaks.css", import.meta.url).href;
  document.head.append(link);
}

export function tweaksGroup({ bundleId = "", store = tweakStore, alert = showAlert, sheet = showActionSheet, onChange = () => {} } = {}) {
  style();
  let items = [];
  const g = el("div", "group ss-tweaks");
  g.append(el("h2", "group-header", "Inject Tweaks"));
  const ul = el("ul", "table grouped");
  const foot = el("p", "group-footer", FOOTER);
  g.append(ul, foot);

  const input = Object.assign(el("input", "visually-hidden"), { type: "file", accept: TWEAK_ACCEPT, multiple: true });
  input.id = "tw" + Math.random().toString(36).slice(2);
  input.addEventListener("change", async () => {
    const picked = [...(input.files ?? [])];
    input.value = "";
    if (!picked.length) return;
    const next = [...items];
    for (const f of picked) {
      const data = new Uint8Array(await f.arrayBuffer());
      const one = { name: f.name, data };
      try { prepareTweaks([one]); } catch (e) {
        // CydiaSubstrate missing is fine here (ElleKit may come next); a file that can't be read is not
        if (!/CydiaSubstrate/.test(String(e?.message))) {
          await alert({ title: "Can't Add This Tweak", message: String(e?.message ?? e), buttons: ["OK"] });
          continue;
        }
      }
      const at = next.findIndex((x) => x.name === f.name);
      if (at >= 0) next[at] = one; else next.push(one);
    }
    items = next;
    draw();
    onChange(items);
  });

  function draw() {
    ul.replaceChildren();
    for (const it of items) {
      const li = el("li", "cell");
      const b = el("button", "cell-inner ss-tweak");
      b.type = "button";
      const t = el("span", "cell-text");
      t.append(el("span", "cell-label", it.name), el("span", "cell-subtitle", `${tweakKind(it.name)} · ${sizeText(it.data.length ?? it.data.byteLength ?? 0)}`));
      b.append(t);
      b.addEventListener("click", async () => {
        const i = await sheet({ title: it.name, buttons: ["Remove"], destructive: 0 });
        if (i !== 0) return;
        items = items.filter((x) => x !== it);
        draw();
        onChange(items);
      });
      li.append(b);
      ul.append(li);
    }
    const li = el("li", "cell");
    const add = Object.assign(el("label", "cell-inner ss-tweak-add"), { htmlFor: input.id });
    add.append(el("span", "cell-label", items.length ? "Add Another Tweak…" : "Add Tweak…"));
    li.append(add, input);
    ul.append(li);
    let why = null;
    try { prepareItems(items); } catch (e) { why = String(e?.message ?? e); }
    foot.textContent = why ? `${why}` : FOOTER;
    foot.classList.toggle("ss-tweak-problem", Boolean(why));
  }
  draw();

  const ready = savedTweaks(bundleId, { store }).then((saved) => { if (!items.length && saved.length) { items = saved; draw(); } }, () => {});
  return {
    el: g,
    ready,
    items: () => [...items],
    save: () => saveTweaks(bundleId, items, { store }).catch(() => {}),
    prepared: async () => prepareItems(items),
  };
}
