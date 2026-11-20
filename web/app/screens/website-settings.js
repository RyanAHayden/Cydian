// F145: Settings > General > Website (the website only; user 2026-11-18: "the lock home setting and install on website
// should not be in signing and it should have the error too"). Two groups:
//   Lock Home Until iFizBox Is Installed  a switch, on while Home is locked (websign-gate.js browsingLocked); off is
//                                        Browse Anyway, on locks Home and the tabs again.
//   Other Apps > Install on the Website  F96's switch (on once the warning was accepted). While the site is locked
//                                        it's locked like Home's rows (.home-locked: dimmed, a padlock where the
//                                        switch was), and a tap asks the same "Install iFizBox First" as Home
//                                        (askToBrowse: Install iFizBox / Browse Anyway (5) / Cancel).
// The box redraws itself on ifizbox:browse-lock (websign-gate.js setFirstVisit), so Browse Anyway from anywhere, or the
// Lock Home switch, unlocks or locks the row at once.
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { detectMode } from "../core/settings.js";
import { showAlert } from "../nav/alert.js";
import { websiteInstallsOn, setWebsiteInstalls, acceptWebsiteInstalls, firstVisitState, setFirstVisit,
  browsingLocked, askToBrowse } from "../websign-gate.js";
import { createSwitch } from "../nav/switch.js";
import { NAME } from "../brand.js";
import { rowIcon } from "../icons/rowicons.js";

export const LOCK_HOME_LABEL = `Lock Home Until ${NAME} Is Installed`;
export const LOCK_HOME_FOOTER = `Home's rows below Install ${NAME} App and the other tabs stay locked, and ask to install `
  + `${NAME} first, until you tap Browse Anyway.`;
export const WEBSITE_INSTALLS_LABEL = "Install on the Website";
// F316 (AGENTS.md Hints): by lock state; locked, the footer says how to unlock it.
export const WEBSITE_INSTALLS_FOOTER = "Slower than the app, and big apps can fail.";
export const WEBSITE_INSTALLS_LOCKED = "Locked until you tap Browse Anyway on Home.";
export const websiteInstallsFooter = (locked) => (locked ? WEBSITE_INSTALLS_LOCKED : WEBSITE_INSTALLS_FOOTER);

// Home's Install iFizBox App flow, loaded when asked (home.js imports Settings' module graph).
const installiFizBox = () => import("./home.js").then((h) => h.installiFizBox());

function switchRow(frag, label, sw) {
  const cell = frag.querySelector(".cell-inner");
  cell?.append(sw);
  cell?.classList.add("has-switch");
  return frag;
}

// -> a div holding both groups; empty outside the website.
export function websiteSection({ mode = detectMode(), storage, alert = showAlert, install = installiFizBox,
  target = globalThis } = {}) {
  const box = document.createElement("div");
  box.className = "website-settings";
  if (mode !== "site") return box;
  const draw = () => {
    const locked = browsingLocked({ mode, storage });
    const lock = switchRow(grouped([{ header: "Website", rows: [{ label: LOCK_HOME_LABEL, icon: rowIcon("lockHome") }], footer: LOCK_HOME_FOOTER }]),
      LOCK_HOME_LABEL, createSwitch({ label: LOCK_HOME_LABEL, checked: firstVisitState(storage) !== "later",
        onToggle: (want) => setFirstVisit(want ? "ask" : "later", storage) }));
    let installs;
    if (locked) {
      // No switch while locked: a padlocked row (home.css .home-locked) that asks first.
      installs = grouped([{ header: "Other Apps", footer: websiteInstallsFooter(true),
        rows: [{ label: WEBSITE_INSTALLS_LABEL, chevron: true, icon: rowIcon("websiteApps"), onClick: (e) => { e?.preventDefault?.(); return askToBrowse({ install, alert, storage }); } }] }]);
      installs.querySelector(".group")?.classList.add("home-locked", "website-locked");
    } else {
      const sw = createSwitch({ label: WEBSITE_INSTALLS_LABEL, checked: websiteInstallsOn(storage), onToggle: async (want) => {
        if (!want) { setWebsiteInstalls(false, storage); return; }
        if (!(await acceptWebsiteInstalls({ alert, storage }))) sw.setAttribute("aria-checked", "false"); // Cancel: back off
      } });
      installs = switchRow(grouped([{ header: "Other Apps", rows: [{ label: WEBSITE_INSTALLS_LABEL, icon: rowIcon("websiteApps") }], footer: websiteInstallsFooter(false) }]),
        WEBSITE_INSTALLS_LABEL, sw);
    }
    box.replaceChildren(lock, installs);
    box.dataset.locked = String(locked);
  };
  draw();
  const onLock = () => {
    // in a page that was popped (a parent, out of the document): stop listening; not yet appended: just redraw
    if (box.isConnected === false && box.parentNode) { target.removeEventListener?.("ifizbox:browse-lock", onLock); return; }
    draw();
  };
  target.addEventListener?.("ifizbox:browse-lock", onLock);
  return box;
}
