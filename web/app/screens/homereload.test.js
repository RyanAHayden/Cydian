// F82: Home's Reload, as Cydia's: the nav button turns into the small spinner while the sources and Home's content
// reload, the page keeps its content (no Loading screen, no flash), and the button comes back as Reload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nav, reloadHome, withReloadSpinner, untilRefreshed } from "./home.js";

// A bar button and a page body, small fakes of the DOM nodes app.js makes (makePage, button()).
function fakeButton(label = "Reload") {
  const classes = new Set(["bar-button"]);
  const attrs = {};
  return {
    textContent: label, disabled: false, attrs,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute(a, v) { attrs[a] = String(v); }, getAttribute: (a) => attrs[a] ?? null, removeAttribute(a) { delete attrs[a]; },
  };
}
const spinning = (b) => b.classList.contains("is-reloading") && b.disabled && b.attrs["aria-busy"] === "true";

test("F82: Reload spins in the button's spot, keeps the page's content, and gives the button back", async () => {
  const button = fakeButton();
  const body = { children: ["head", "tiles", "links"] }; // what Home shows before the tap
  const shown = body.children;
  const seen = [];
  let finishRefresh;
  const done = reloadHome(button, {}, { web: false,
    refresh: () => new Promise((r) => { finishRefresh = r; seen.push("refresh"); }),
    settled: async () => { seen.push("settled"); },
    reload: async () => { seen.push("reload"); }, // the new package lists, dpkg, iFizBox's own update
    redraw: async () => {
      seen.push("redraw");
      assert.ok(spinning(button), "still the spinner while Home redraws");
      body.children[1] = "tiles, updated"; // in place: the same page, one part swapped
    },
  });
  assert.ok(spinning(button), "the tap turns the button into the spinner at once");
  assert.equal(button.textContent, "Reload", "the label stays (hidden by CSS), so the button needs no rebuilding");
  assert.equal(button.attrs["aria-label"], "Reloading");
  assert.equal(body.children, shown, "nothing is cleared while the sources reload: no Loading screen");
  assert.deepEqual(body.children, ["head", "tiles", "links"]);
  // A second tap while it spins does nothing.
  assert.equal(await reloadHome(button, {}, { web: false, refresh: () => assert.fail("no second reload") }), false);
  finishRefresh();
  assert.equal(await done, true);
  assert.deepEqual(seen, ["refresh", "settled", "reload", "redraw"], "new versions load before Home redraws");
  assert.equal(body.children, shown, "the same page, updated where it stood");
  assert.deepEqual(body.children, ["head", "tiles, updated", "links"]);
  assert.ok(!button.classList.contains("is-reloading"), "back to Reload");
  assert.equal(button.disabled, false);
  assert.equal(button.attrs["aria-busy"], undefined);
  assert.equal(button.attrs["aria-label"], undefined);
});

test("F82: a reload that fails still gives the button back", async () => {
  const button = fakeButton();
  button.setAttribute("aria-label", "Reload Home");
  assert.equal(await withReloadSpinner(button, async () => { throw new Error("offline"); }), true);
  assert.ok(!spinning(button));
  assert.equal(button.attrs["aria-label"], "Reload Home");
});

test("F82: Home's Reload no longer reloads the whole page", async () => {
  const right = nav({ tab: "home", path: [] }, {}).right;
  assert.equal(right.label, "Reload");
  const saved = globalThis.location;
  let reloaded = false;
  globalThis.location = { reload: () => { reloaded = true; }, hash: "#/home" };
  try {
    // no button (a click the page never saw): nothing happens, and above all no location.reload()
    assert.equal(await right.onClick({ currentTarget: null }), false);
  } finally {
    globalThis.location = saved;
  }
  assert.equal(reloaded, false);
});

test("F82: Reload waits for a refresh already running, and never for ever", async () => {
  const saved = globalThis.ifizboxRefreshing;
  const events = new EventTarget(); // the window's events, as sources.js announce() sends them
  const had = { add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  try {
    globalThis.ifizboxRefreshing = 0;
    await untilRefreshed(); // nothing running: at once
    globalThis.ifizboxRefreshing = 2;
    let ended = false;
    const p = untilRefreshed(5000).then(() => { ended = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ended, false, "still refreshing");
    globalThis.ifizboxRefreshing = 0;
    events.dispatchEvent(new Event("ifizbox:refreshing"));
    await p;
    globalThis.ifizboxRefreshing = 1;
    await untilRefreshed(20); // a refresh that never says it ended: the cap lets the button come back
  } finally {
    globalThis.ifizboxRefreshing = saved;
    globalThis.addEventListener = had.add;
    globalThis.removeEventListener = had.remove;
  }
});

test("the website's Reload re-downloads every listed file past the browser's cache, then reloads; the footer shows the build", async () => {
  const { refreshWebFiles, footLine } = await import("./home.js");
  const got = [];
  let reloaded = false;
  const fetcher = async (u, o) => { got.push([u, o?.cache]); return { ok: true, json: async () => ({ files: ["app.js", "nav/ui.js"] }) }; };
  assert.equal(await refreshWebFiles({ fetcher, reloadPage: () => { reloaded = true; } }), true);
  assert.deepEqual(got, [["build.json", "no-store"], ["app.js", "reload"], ["nav/ui.js", "reload"]]);
  assert.ok(reloaded);
  assert.equal(await refreshWebFiles({ fetcher: async () => ({ ok: false }), reloadPage: () => assert.fail() }), false); // no build.json
  assert.equal(footLine({ ios: "26.1", version: "0.3.5", web: true }, "en-US"), "iPhone, iOS 26.1, iFizBox Web 0.3.5 (en-us)");
});
