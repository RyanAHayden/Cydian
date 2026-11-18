// F72: the padlock a built-in source (core/essential.js, Cydian's own) shows instead of Delete: `lockIcon(size)` an
// SVG, grey like iOS 6's secondary text; sources.css .source-lock (Manage's edit list, where the red minus goes) and
// .name-lock (after the name, in the Sources tab) place it.
const NS = "http://www.w3.org/2000/svg";

function lockIcon(size = 13) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 12 16");
  svg.setAttribute("width", String(Math.round(size * 12 / 16)));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const shackle = document.createElementNS(NS, "path");
  shackle.setAttribute("d", "M3 7V4.5a3 3 0 0 1 6 0V7");
  shackle.setAttribute("fill", "none");
  shackle.setAttribute("stroke", "#8a8a8a");
  shackle.setAttribute("stroke-width", "1.8");
  const body = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: "0.5", y: "6.5", width: "11", height: "9", rx: "1.5", fill: "#8a8a8a" })) body.setAttribute(k, v);
  svg.append(shackle, body);
  return svg;
}

// The span for a row: `kind` "source-lock" (left, edit list) or "name-lock" (after the name).
export function lockMark(kind = "name-lock", label = "Built in: can't be removed") {
  const s = document.createElement("span");
  s.className = kind;
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", label);
  s.title = label;
  s.append(lockIcon(kind === "source-lock" ? 18 : 12));
  return s;
}
