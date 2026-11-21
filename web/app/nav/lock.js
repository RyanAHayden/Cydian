// F72: the padlock a built-in source (core/essential.js, iFizBox's own) shows instead of Delete, grey like iOS 6's
// secondary text; sources.css .source-lock (Manage's edit list, where the red minus goes) and .name-lock (after the
// name, in the Sources tab) place it. Its art is sources.css's --lock-icon token (.lock-icon), so a style can swap it.

// The span for a row: `kind` "source-lock" (left, edit list) or "name-lock" (after the name).
export function lockMark(kind = "name-lock", label = "Built in: can't be removed") {
  const s = document.createElement("span");
  s.className = kind;
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", label);
  s.title = label;
  const icon = document.createElement("span");
  icon.className = "lock-icon";
  icon.setAttribute("aria-hidden", "true");
  s.append(icon);
  return s;
}
