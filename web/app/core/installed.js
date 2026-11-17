// Installed packages and their upgrades. The core takes dpkg's status file as text: on the site the visitor
// uploads it (kept on the device, catalog.js), in the app the native backend reads it (N3). Pure JS, no DOM, no
// I/O; the worker's catalog (core/catalog.js) holds the parsed list and answers `installed` and `upgrades`.
//
//   parseStatus(text)                         -> [pkg]: the installed packages, sorted by name
//   findUpgrades(installed, candidateOf, holds, { dpkgHolds }) -> { available: [row], ignored: [row] }
//
// Cydia's rule (docs/cydia.md "Changes and metadata.cb0"): a package is upgradable when it is installed and its
// candidate (the newest version on any source) is newer than the installed one. Held packages (dpkg's `hold`
// selection, or Cydian's Ignored Upgrades list) go under Ignored Upgrades, not Available Upgrades.
import { parseControl, description, compareVersions } from "./apt.js";
import { sectionName, parseAuthor, compareNames } from "./catalog.js";

// Where dpkg keeps it: rootful, then rootless (Dopamine, palera1n rootless).
export const STATUS_PATHS = ["/var/lib/dpkg/status", "/var/jb/var/lib/dpkg/status"];

// dpkg's package states that leave the package's files on disk (dpkg(1) "package states"). `not-installed` and
// `config-files` don't: those stanzas are leftovers, not installed packages.
const ON_DISK = new Set(["installed", "half-installed", "unpacked", "half-configured", "triggers-awaited", "triggers-pending"]);

// "want flag state", e.g. "hold ok installed" -> { want: "hold", state: "installed" }.
export function parseStatusField(value) {
  const [want = "", , state = ""] = String(value ?? "").trim().split(/\s+/);
  return { want, state };
}

// One installed package, shaped like a catalog row (core/catalog.js) so the same lists draw it, plus `held`
// (dpkg's hold selection) and `state` (anything but "installed" means a broken install).
function installedRow(st) {
  const { want, state } = parseStatusField(st.status);
  const name = st.name || st.package;
  return {
    id: st.package, name, short: description(st).short, version: st.version ?? "", section: sectionName(st.section),
    icon: null, key: null, author: parseAuthor(st.author)?.name || parseAuthor(st.maintainer)?.name || "",
    held: want === "hold", state, essential: /^yes$/i.test(st.essential ?? ""),
  };
}

// The packages dpkg has on disk, sorted by name. A file that isn't a status file (no Status fields) gives [].
export function parseStatus(text) {
  const out = [];
  const seen = new Set();
  for (const st of parseControl(text)) {
    if (!st.package || !st.version || seen.has(st.package)) continue;
    if (!ON_DISK.has(parseStatusField(st.status).state)) continue;
    seen.add(st.package);
    out.push(installedRow(st));
  }
  return out.sort(compareNames);
}

// Whether text looks like a dpkg status file: at least one stanza with Package and Status. For the upload, so a
// Packages file or a random text file is refused with a message instead of an empty Installed tab.
export function looksLikeStatus(text) {
  return parseControl(String(text ?? "").slice(0, 65536)).some((st) => st.package && st.status);
}

// `installed`: parseStatus rows. `candidateOf(id)`: the row of the newest version on any source (with `version`),
// or null. `holds`: Cydian's Ignored Upgrades (package ids). Each result row is the candidate's row with
// `installed` (the version on the device) added; both lists sorted by name. `dpkgHolds` off ignores the status
// file's hold flags: the app passes that, since there `holds` already is dpkg's list (apt-mark showhold, F22) and
// is newer than the status file it read.
export function findUpgrades(installed, candidateOf, holds = [], { dpkgHolds = true } = {}) {
  const ignoredIds = new Set(holds);
  const available = [];
  const ignored = [];
  for (const pkg of installed) {
    const cand = candidateOf(pkg.id);
    if (!cand || compareVersions(cand.version, pkg.version) <= 0) continue;
    const row = { ...cand, installed: pkg.version };
    ((dpkgHolds && pkg.held) || ignoredIds.has(pkg.id) ? ignored : available).push(row);
  }
  return { available: available.sort(compareNames), ignored: ignored.sort(compareNames) };
}
