// Search tab: the kit's "grey search bar" over a virtualised result list. Every keystroke (debounced) asks the
// catalog in the parse worker, which matches name, id, description, Author and Maintainer (core/catalog.js
// search), best matches first. Results open the package page; its Author row lists all their packages.
// Below the root, the routes are screens/browse.js tokens (package:<id>, author:<name>).
import * as browse from "./browse.js";
import { catalog } from "../catalog.js";
import { filterRow } from "../device.js";

export const title = "Search";

const state = { query: "", seq: 0 };
let rootInput = null; // the root page's field, for reselect()

// A tap on the Search tab while already on its root (nav/tabbar.js tapTab, F36): focus the field. Called straight
// from the tap's click handler, never after an await or timer, or iOS won't bring up the keyboard.
export function reselect() {
  if (!rootInput || !rootInput.isConnected) return false;
  rootInput.focus();
  return true;
}

export function nav(route) {
  if (route.path.length) return browse.nav(route);
  return { title: "Search", style: "plain" };
}

export function render(body, route, ctx) {
  if (route.path.length) {
    browse.render(body, route, ctx);
    return;
  }
  const bar = document.createElement("form");
  bar.className = "search-bar";
  bar.setAttribute("role", "search");
  const field = document.createElement("label");
  field.className = "search-field";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search";
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("autocorrect", "off");
  input.setAttribute("aria-label", "Search packages: name, description or author");
  input.enterKeyHint = "search";
  input.value = state.query;
  rootInput = input;
  field.append(input);
  bar.append(field);
  const note = document.createElement("p");
  note.className = "empty search-note";
  // Works on My Phone (F17): the same switch as the Sections page; flipping it searches again.
  body.append(bar, filterRow(() => run()), note);

  const list = browse.packageList(body, route, [], { letters: false });
  body.append(list.el);

  let timer = 0;
  async function run() {
    const q = input.value.trim();
    state.query = input.value;
    const seq = ++state.seq;
    if (!q) {
      list.setItems([]);
      note.textContent = "Package names, descriptions and authors.";
      return;
    }
    note.textContent = "";
    let rows;
    try {
      rows = await catalog.search(q);
    } catch (e) {
      if (seq === state.seq) note.textContent = e.message;
      return;
    }
    if (seq !== state.seq) return; // a newer keystroke won
    body.scrollTop = 0;
    browse.rememberNames(rows);
    list.setItems(rows);
    note.textContent = rows.length ? "" : "No Results";
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 120); });
  bar.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); input.blur(); });
  run();
}
