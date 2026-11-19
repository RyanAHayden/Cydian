// F151: progressHUD, the HUD interface on the progress page (the sideload IPA's and the website's installs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressHUD } from "./progress.js";

function fakePage() {
  const p = {
    calls: [], closed: false, closers: [],
    line(kind, text) { p.calls.push([kind, text]); },
    step(t) { p.line("step", t); }, error(t) { p.line("error", t); },
    status(t) { p.calls.push(["status", t]); },
    progress(n) { p.calls.push(["progress", n]); },
    finish(o) { p.calls.push(["finish", o.label, o.status]); },
    reopen() { p.calls.push(["reopen"]); },
    onClose(f) { p.closers.push(f); },
    close() { p.closed = true; p.closers.forEach((f) => f()); },
  };
  return p;
}

test("progressHUD: each label is a step, its percent moves the bar; done ends on Close (B45: not Close iFizBox)", () => {
  const page = fakePage();
  const h = progressHUD("Downloading", { open: () => page });
  h.set("Downloading 10%");
  h.set("Downloading 60%");
  h.set("Signing");
  h.done("Done");
  assert.deepEqual(page.calls.filter(([k]) => k === "step"), [["step", "Downloading"], ["step", "Signing"], ["step", "Done"]]);
  assert.deepEqual(page.calls.filter(([k]) => k === "progress"), [["progress", 10], ["progress", 60]]);
  assert.deepEqual(page.calls.at(-1), ["finish", "Close", "Done"]);
  h.set("Installing"); // after the end: nothing
  assert.deepEqual(page.calls.at(-1), ["finish", "Close", "Done"]);
  page.close();
});

test("progressHUD: fail shows the error in red; hide completes without a word of its own", () => {
  const page = fakePage();
  const h = progressHUD("Signing", { open: () => page });
  h.fail("The certificate was revoked.");
  assert.deepEqual(page.calls.slice(-2), [["error", "The certificate was revoked."], ["finish", "Close", "Failed"]]);
  h.hide();
  assert.equal(page.calls.filter(([k]) => k === "finish").length, 1);
  page.close();

  const p2 = fakePage();
  const h2 = progressHUD("Installing", { open: () => p2 });
  h2.set("Installed");
  h2.hide();
  assert.deepEqual(p2.calls.at(-1), ["finish", "Close", null]);
  p2.close();
});

test("progressHUD: the next job of a run continues on the page while it is up; a new page once it is closed", () => {
  const pages = [];
  const open = () => { const p = fakePage(); pages.push(p); return p; };
  progressHUD("Downloading", { open }).done();
  progressHUD("Downloading", { open }).done();
  assert.equal(pages.length, 1);
  assert.ok(pages[0].calls.some(([k]) => k === "reopen"));
  pages[0].close();
  progressHUD("Downloading", { open }).hide();
  assert.equal(pages.length, 2);
  pages[1].close();
});

test("progressHUD: finish ends on the caller's button (F155's Open <app>), its action handed to the page", () => {
  const page = fakePage();
  let action = null;
  page.finish = (o) => { action = o.action; page.calls.push(["finish", o.label, o.status]); };
  const h = progressHUD("Installing", { open: () => page });
  h.set("Installed");
  const go = () => false;
  h.finish({ label: "Open Delta", action: go, status: "Installed" });
  assert.deepEqual(page.calls.at(-1), ["finish", "Open Delta", "Installed"]);
  assert.equal(action, go);
  h.done("Done"); // already ended: nothing more
  assert.equal(page.calls.filter(([k]) => k === "finish").length, 1);
  page.close();
});

test("progressHUD (B27): two jobs on one page: it completes when the last one ends, on that one's button", () => {
  const page = fakePage();
  const open = () => page;
  const a = progressHUD("Downloading", { open });
  const b = progressHUD("Downloading", { open });
  b.done("Done");
  assert.equal(page.calls.filter(([k]) => k === "finish").length, 0);
  a.set("Installing 72%");
  assert.deepEqual(page.calls.at(-1), ["progress", 72]);
  a.finish({ label: "Open A", status: "Installed" });
  assert.deepEqual(page.calls.at(-1), ["finish", "Open A", "Installed"]);
  page.close();
});
