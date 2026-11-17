// Changes tab. Placeholder until F6: sample rows that show the plain list with section headers; the tab's badge
// counts them, as Cydia's counts available upgrades.
import { plain } from "../nav/ui.js";

export const title = "Changes";

const SAMPLE = [
  { header: "Sample: New at Nov 17", rows: [
    { label: "Example Tweak", subtitle: "Updated to 1.2.0" },
    { label: "Another Package", subtitle: "New: 0.9" },
  ] },
  { header: "Sample: New at Nov 16", rows: [{ label: "Older Package", subtitle: "Updated to 3.1" }] },
];

export function init(ctx) {
  ctx.setBadge("changes", SAMPLE[0].rows.length);
}

export function nav() {
  return { title: "Changes", style: "plain" };
}

export function render(el) {
  el.append(plain(SAMPLE));
}
