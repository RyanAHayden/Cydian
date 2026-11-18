// F96: the website pushes Cydian first (user 2026-11-18: "we push users toward installing cydian FIRST when the
// webpage is launched. all others should be disabled until they accept a delayed warning that the experience on web
// will not be good"). Website only: the app never asks.
//
//   First visit (until Cydian is installed from the website, or Not Now): "Install Cydian First" at launch
//   (promptFirstVisit, from screens/home.js init), Install Cydian running Home's Install Cydian App flow.
//   Other apps' pages: installRows (screens/altstore.js) gives "Install in Cydian" (cydian://package?id=…, which the
//   app's incoming.js opens at that app's page), Download IPA, then "Install on the Website", greyed out until the
//   user accepts the warning once (acceptWebsiteInstalls: its I Understand counts down 5 seconds first). Cydian's own
//   IPA always installs from the website. Settings > Signing's switch turns website installs back off.
//
// State is in localStorage, per browser; every function takes `storage` for tests.
// SPDX-License-Identifier: GPL-3.0-or-later
import { showAlert } from "./nav/alert.js";

export const ACCEPT_KEY = "cydian.websiteInstalls"; // "on" once the warning was accepted
export const FIRST_KEY = "cydian.firstVisit"; // "later" (Not Now) | "installed" (Cydian installed from here)

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (storage, key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
const write = (storage, key, v) => {
  try { if (v == null) storage?.removeItem(key); else storage?.setItem(key, v); } catch { /* private mode: this page only */ }
};

// ---- Install on the Website ------------------------------------------------------------------------------------

export function websiteInstallsOn(storage = store()) { return read(storage, ACCEPT_KEY) === "on"; }
export function setWebsiteInstalls(on, storage = store()) { write(storage, ACCEPT_KEY, on ? "on" : null); }

export const WARNING_SECONDS = 5;
export const WARNING = {
  title: "Install on the Website?",
  message: "Installing here is slow: Safari downloads the app, signs it with your certificate, uploads it to this "
    + "site, and then iOS downloads it again. Big apps or a weak connection can make it fail, and the signed apps use "
    + "this site's limited storage.\n\nInstall in Cydian signs and installs on the iPhone itself: much faster, with no "
    + "upload and no limits.",
  buttons: ["Cancel", "I Understand"],
  cancel: 0,
};

// The warning, once: true when website installs are on (already, or the user just accepted).
export async function acceptWebsiteInstalls({ alert = showAlert, storage = store() } = {}) {
  if (websiteInstallsOn(storage)) return true;
  const { index } = await alert({ ...WARNING, countdown: { button: 1, seconds: WARNING_SECONDS } });
  if (index !== 1) return false;
  setWebsiteInstalls(true, storage);
  return true;
}

// ---- Install in Cydian -----------------------------------------------------------------------------------------

export const packageLink = (id) => `cydian://package?id=${encodeURIComponent(String(id))}`;

// cydian://package?id=<id> -> the id, or null.
export function packageIdOf(link) {
  let id = null;
  try { id = new URL(String(link)).searchParams.get("id"); } catch { return null; }
  id = (id ?? "").trim();
  return id && id.length <= 300 && !/[/\s]/.test(id) ? id : null;
}

// The app's id from the page's hash when the caller doesn't know it: browse.js's package:<id> or versions:<id>.
export function idFromHash(hash = globalThis.location?.hash ?? "") {
  const parts = String(hash).replace(/^#\/?/, "").split("/").map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = /^(?:package|versions):(.+)$/.exec(parts[i]);
    if (m) return m[1];
  }
  return null;
}

export const IN_CYDIAN_SUBTITLE = "Signed and installed on the iPhone: fast, no limits";
export const WEBSITE_ON_SUBTITLE = "Signed in the browser with your certificate";
export const WEBSITE_OFF_SUBTITLE = "Slow, and can fail on big apps: tap to read why";
export const SITE_GATE_FOOTER = "Install in Cydian opens this app in the Cydian app, which signs and installs it on the "
  + "iPhone. Download IPA keeps the file. Installing on the website is slower and can fail on big apps.";

// The website's rows for an app that isn't Cydian, in order: Install in Cydian, Download IPA (`download`, the row
// installRows makes), Install on the Website (greyed out until accepted; once accepted it runs `install`).
export function siteGateRows({ id, install, download = null, open = (u) => { location.href = u; }, alert = showAlert, storage = store() }) {
  const on = websiteInstallsOn(storage);
  const rows = [{ label: "Install in Cydian", subtitle: IN_CYDIAN_SUBTITLE, onClick: () => open(packageLink(id ?? idFromHash() ?? "")) }];
  if (download) rows.push(download);
  rows.push({ label: "Install on the Website", subtitle: on ? WEBSITE_ON_SUBTITLE : WEBSITE_OFF_SUBTITLE, cls: on ? null : "websign-off",
    onClick: async (e) => {
      const li = e?.currentTarget?.closest?.("li");
      if (!(await acceptWebsiteInstalls({ alert, storage }))) return;
      if (li) {
        li.classList.remove("websign-off");
        const sub = li.querySelector(".cell-subtitle");
        if (sub) sub.textContent = WEBSITE_ON_SUBTITLE;
      }
      return install();
    } });
  return rows;
}

// ---- First visit -----------------------------------------------------------------------------------------------

// "ask" | "later" | "installed"
export function firstVisitState(storage = store()) {
  const v = read(storage, FIRST_KEY);
  return v === "later" || v === "installed" ? v : "ask";
}
export function setFirstVisit(state, storage = store()) { write(storage, FIRST_KEY, state === "ask" ? null : state); }
export const markCydianInstalled = (storage = store()) => setFirstVisit("installed", storage);

export const shouldAskFirst = ({ mode = "site", storage = store() } = {}) => mode === "site" && firstVisitState(storage) === "ask";

export const FIRST_VISIT = {
  title: "Install Cydian First",
  message: "Apps installed in the Cydian app are signed and installed on the iPhone itself: much faster than this "
    + "website, with no upload and no limits.\n\nInstall Cydian now, then install everything else from it.",
  buttons: ["Not Now", "Install Cydian"],
  cancel: 0,
};

// Asks once per launch while the state is "ask". Install Cydian runs `install` (Home's Install Cydian App flow);
// Not Now is remembered, and Home's green Install Cydian App tile stays as the reminder. -> "install" | "later" | null
let asked = false;
export async function promptFirstVisit({ mode, install, alert = showAlert, storage = store(), once = true } = {}) {
  if (!shouldAskFirst({ mode, storage }) || (once && asked)) return null;
  if (once) asked = true;
  const { index } = await alert(FIRST_VISIT);
  if (index !== 1) { setFirstVisit("later", storage); return "later"; }
  await install?.();
  return "install";
}

// Home on the website while Cydian isn't installed (user 2026-11-18): nothing pops up at launch; everything below the
// Cydian App card is locked (greyed, a lock in place of the chevron). A tap on a locked row asks: Install Cydian, or
// Ignore, which counts down from 5 before it can be tapped and then unlocks browsing for good in this browser.
export const browsingLocked = ({ mode = "site", storage = store() } = {}) => mode === "site" && firstVisitState(storage) === "ask";
export const BROWSE_GATE = {
  title: "Install Cydian First",
  message: "Apps installed in the Cydian app are signed and installed on the iPhone itself: much faster than this "
    + "website, with no upload and no limits.\n\nYou can browse the website anyway, but installing here is slow and can fail on big apps.",
  buttons: ["Ignore", "Install Cydian"],
  cancel: -1,
};
// -> "browse" (Ignore: unlocked from now on) | "install" | null
export async function askToBrowse({ install, alert = showAlert, storage = store() } = {}) {
  const { index } = await alert({ ...BROWSE_GATE, countdown: { button: 0, seconds: WARNING_SECONDS } });
  if (index === 0) { setFirstVisit("later", storage); return "browse"; }
  if (index === 1) { await install?.(); return "install"; }
  return null;
}
