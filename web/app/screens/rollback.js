// Roll Back (F71, jailbreak build): the package page's group listing the .debs N7's daemon kept when automatic
// updates replaced a version (<prefix>/var/cache/ifizbox/rollback/<id>/), through backend.rollbacks(id). Tapping one
// asks first, then installs it in the install queue's console (screens/queue.js runRollback: ifizbox-helper rollback,
// apt-get install of the stored file). The group fills in once the helper answers, so the page never waits for it;
// with nothing stored (or no helper) it stays empty.
//
//   body.append(rollbackSlot(id, { installed, name }))   // only when getBackend().rollbacks exists
// SPDX-License-Identifier: GPL-3.0-or-later
import { grouped } from "../nav/ui.js";
import { showActionSheet } from "../nav/actionsheet.js";
import { showAlert } from "../nav/alert.js";
import { getBackend } from "../backend.js";
import { compareVersions } from "../core/apt.js";
import { runRollback } from "./queue.js";

export const hasRollback = () => typeof getBackend().rollbacks === "function";

// The rows for `stored` ([{ version, file }]) beside the installed version: every copy but the installed one,
// newest first, with whether it is older or newer than what is installed.
export function rollbackRows(stored, installed) {
  return stored
    .filter((s) => s.version !== installed)
    .map((s) => ({ version: s.version, detail: !installed ? "" : compareVersions(s.version, installed) < 0 ? "Older" : "Newer" }));
}

export function rollbackSlot(id, { installed = null, name = "" } = {}) {
  const slot = document.createElement("div");
  slot.className = "package-rollback-slot";
  slot.dataset.id = id;
  getBackend().rollbacks(id).then((stored) => {
    const rows = rollbackRows(stored ?? [], installed);
    if (!rows.length || !slot.isConnected) return;
    slot.replaceChildren(grouped([{
      header: "Roll Back",
      rows: rows.map((r) => ({ label: r.version, detail: r.detail, onClick: () => confirmRollback(id, r.version, { installed, name }) })),
      footer: "Copies of the versions automatic updates replaced, kept on this iPhone. Tap one to install it again.",
    }]));
  }, () => {});
  return slot;
}

async function confirmRollback(id, version, { installed, name }) {
  const what = name || id;
  const title = installed
    ? `Install the copy of ${what} ${version} kept on this iPhone, in place of ${installed}?`
    : `Install the copy of ${what} ${version} kept on this iPhone?`;
  const i = await showActionSheet({ title, buttons: [`Roll Back to ${version}`] });
  if (i !== 0) return;
  if (!runRollback({ id, version, installed, name })) {
    await showAlert({ title: "Roll Back", message: "Another install is running. Try again when it has finished.", buttons: ["OK"] });
  }
}
