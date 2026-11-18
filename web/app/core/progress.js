// F151: the install progress page's brain, without the DOM (nav/progress.js draws it). Cydia's Running/Complete page
// (docs/cydia.md "Running: the console"), cleaner and more like a terminal:
//
//   classify({ fd, line })        -> one streamed line as the page shows it (null: nothing to show):
//     { kind: "step", text, pkg?, percent?, download? }  apt's status fd (pmstatus/dlstatus, dpkg's status:/processing:):
//                                                        bold Helvetica Neue, white; the percent moves the bar
//     { kind: "raw", text }          apt's, dpkg's and the maintainer scripts' own output: monospace, grey
//     { kind: "error", text, pkg? }  pmerror, "E:", "dpkg: error", the helper's own complaints: red, with the x badge
//     { kind: "warning", text }      "W:": yellow, with the warning badge
//     { kind: "conffile", file, percent? }  dpkg asks about a conffile (screens/queue.js answers it)
//     { kind: "finish", finish }     a maintainer script's finish:<word> (Cydia's $CYDIA protocol): not shown
//   hudLine(text)                 -> a HUD label ("Downloading 45%") as { text: "Downloading", percent: 45 }
//   createFollow({ slack })       -> auto-scroll: follows the newest line until the user scrolls up, again once
//                                    they are back at the bottom; never moves the page under a finger
//   packageKind(stanzas)          -> "tweak" | "app" | "package": what a run of it needs at the end
//   chooseFinish({ ok, levels, kinds, build }) -> { level, label, uicache }: the big bottom button, as Cydia's
//                                    finish actions: the highest of the scripts' finish: words and what the kinds
//                                    of package need. uicache: refresh the home screen's icons before the action.
// SPDX-License-Identifier: GPL-3.0-or-later
import { parseStatusLine, consoleText, needsRestart, finishOf, FINISH_LABEL } from "./queue.js";

export function classify({ fd = "out", line = "" } = {}) {
  if (fd === "status") {
    const s = parseStatusLine(String(line ?? "").replace(/\s+$/, ""));
    if (s.type === "status") {
      if (!s.text) return null;
      return { kind: "step", text: s.text, ...(s.pkg ? { pkg: s.pkg } : {}), ...(s.percent != null ? { percent: s.percent } : {}),
        ...(s.download ? { download: true } : {}) };
    }
    if (s.type === "error") return { kind: "error", text: s.text, ...(s.pkg ? { pkg: s.pkg } : {}) };
    if (s.type === "conffile") return { kind: "conffile", file: s.file, ...(s.percent != null ? { percent: s.percent } : {}) };
    if (s.type === "finish") return { kind: "finish", finish: s.finish };
    return s.text ? { kind: "raw", text: s.text } : null;
  }
  const text = consoleText(line).replace(/\s+$/, "");
  if (!text) return null;
  if (/^(E: |E:$|dpkg: error|dpkg: dependency problems|Errors were encountered|cydian-helper: (?!cancelled))/.test(text)) return { kind: "error", text };
  if (/^(W: |W:$|dpkg: warning)/.test(text)) return { kind: "warning", text };
  return { kind: "raw", text };
}

// A HUD's label as the page shows it: the step without its percent, and the percent for the bar. "Installing 3 of 5"
// stays as it is.
export function hudLine(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^(.*?)\s*\(?(\d{1,3}(?:\.\d+)?)\s?%\)?$/);
  if (m && m[1]) return { text: m[1], percent: Math.max(0, Math.min(100, Number(m[2]))) };
  return { text: s, percent: null };
}

// Auto-scroll. The page calls scrolled() on every scroll event with the scroller's metrics, touch(true|false) as a
// finger goes down and up, and asks shouldScroll() after adding lines. Lines are trimmed from the top only while it
// follows (trimming under a reader would move what they read).
//   const f = createFollow();  f.scrolled({ top, height, client }); f.touch(true); f.shouldScroll(); f.jump()
export function createFollow({ slack = 32 } = {}) {
  let following = true;
  let touching = false;
  const atBottom = ({ top = 0, height = 0, client = 0 } = {}) => height - (top + client) <= slack;
  return {
    get following() { return following; },
    scrolled(m) { following = atBottom(m); },
    touch(down, m = null) {
      touching = Boolean(down);
      if (!touching && m) following = atBottom(m);
    },
    shouldScroll() { return following && !touching; },
    jump() { following = true; },
  };
}

// What a package needs once it is in: a tweak (it hooks through Substrate/ElleKit, or it is filed as one or as a
// theme) a SpringBoard restart; an app (filed under Applications, Apps or Games, or carrying an .app's tag) the home
// screen's icon cache rebuilt (uicache); anything else nothing.
const TWEAK_SECTION = /^(tweaks?|themes?(\s*\(.*\))?|springboard|system\s*tweaks?|widgets?|lock\s*screen|winterboard|snowboard|addons?\s*\(springboard\))$/i;
const APP_SECTION = /^(apps?|applications?|games?)(\s*\(.*\))?$/i;
export function packageKind(stanzas = []) {
  const list = (Array.isArray(stanzas) ? stanzas : [stanzas]).filter(Boolean);
  if (needsRestart(list)) return "tweak";
  const section = (st) => String(st.section ?? "").trim();
  if (list.some((st) => TWEAK_SECTION.test(section(st)))) return "tweak";
  if (list.some((st) => APP_SECTION.test(section(st)) || /\brole::(app|application)\b|\bcydia::app\b/.test(String(st.tag ?? "")))) return "app";
  return "package";
}

const KIND_LEVEL = { tweak: "restart", app: "uicache" };

// build: "jailbreak" (apt and the helper: every level), else the sideload IPA or the website (just Return).
export function chooseFinish({ ok = true, levels = [], kinds = [], build = "jailbreak" } = {}) {
  if (!ok || build !== "jailbreak") return { level: "return", label: FINISH_LABEL.return, uicache: false };
  const level = finishOf(...levels, ...kinds.map((k) => KIND_LEVEL[k] ?? "return"));
  // A respring or a reboot doesn't rebuild the icon cache; an app in the same run still needs it, first.
  const uicache = level !== "uicache" && level !== "return" && level !== "reopen"
    && (kinds.includes("app") || levels.includes("uicache"));
  return { level, label: FINISH_LABEL[level], uicache };
}
