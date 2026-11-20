// B164: Sign Options' layout. The arm64e Fix-Up and Keep Bundle ID switches sit at the right edge of their rows (a
// bare .cell-label before a switch takes the row's room, ios6.css), and the Icon row's Choose button is inside that
// row as a flex item (.sign-row.has-browse), not an absolute button over the next group's footer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { iconCell } from "./myipas.js";
import { withDocument } from "../fakes.test-helper.js";

const css = readFileSync(new URL("../ios6.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const decl = (sel) => rules.filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel)).map((r) => r.decl).join(";");

test("Icon row: the Choose button is a child of the row, after the value", () => {
  withDocument(() => {
    const li = iconCell({ icon: null }, { iconPNG: async () => "x" });
    const row = li.children.find((c) => c.className.includes("cell-inner"));
    assert.ok(row, "the row");
    assert.ok(row.className.split(" ").includes("has-browse"), row.className);
    const cls = row.children.map((c) => c.className);
    assert.deepEqual(cls, ["cell-label", "sign-value", "bar-button sign-browse"], "label, value, then the button, all in the row");
    assert.equal(row.children[2].textContent, "Choose");
    assert.equal(row.children[1].textContent, "The App's");
    assert.ok(!li.children.some((c) => c.className.includes("sign-browse")), "no button beside the row in the cell");
    // Reset: the same button, inside the same row.
    const chosen = iconCell({ icon: "png" }, { iconPNG: async () => "x" });
    const btn = chosen.children[0].children[2];
    assert.equal(btn.textContent, "Reset");
    btn.listeners.click[0]({ preventDefault() {} });
    assert.equal(btn.textContent, "Choose");
    assert.equal(chosen.children[0].children[1].textContent, "The App's");
  });
});

test("ios6.css: a row's own button is a static flex item, with no room kept for an absolute one", () => {
  const b = decl(".sign-row.has-browse > .sign-browse");
  assert.match(b, /position:\s*static/);
  assert.match(b, /transform:\s*none/);
  assert.match(b, /flex:\s*none/);
  assert.match(decl(".sign-row.has-browse"), /padding-right:\s*9px/, "not .sign-row's 78px");
  assert.match(decl(".sign-value"), /flex:\s*1/);
  assert.match(decl(".sign-value"), /text-align:\s*right/);
});

test("ios6.css: a bare label before a switch fills the row, so the switch sits at the right edge", () => {
  const l = decl(".cell-inner.has-switch > .cell-label");
  assert.match(l, /flex:\s*1/);
  assert.match(l, /min-width:\s*0/);
  assert.match(decl(".switch"), /flex:\s*none/);
});

test("Sign Options: the arm64e and Keep Bundle ID rows are a label then a switch in a .has-switch row", () => {
  const src = readFileSync(new URL("./myipas.js", import.meta.url), "utf8");
  for (const label of ["arm64e Fix-Up", "Keep Bundle ID"]) {
    const re = new RegExp(`(\\w+)\\.append\\(el\\("span", "cell-label", "${label}"\\), createSwitch\\(`);
    const m = re.exec(src);
    assert.ok(m, `${label}: label then switch`);
    assert.match(src, new RegExp(`const ${m[1]} = el\\("div", "cell-inner has-switch"\\)`), `${label}: in a .has-switch row`);
  }
});
