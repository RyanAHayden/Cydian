// A modal sheet, as iOS 6 presents one (presentModalViewController): it slides up over everything with its own
// blue nav bar, a title and a Done button, and slides back down on Done or Escape. Transform only.
// Styles: packages.css (.sheet).
//
//   const close = showSheet({ title: "Depiction", body: element, onClose });
export function showSheet({ title = "", body, onClose = () => {} } = {}) {
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title);

  const bar = document.createElement("header");
  bar.className = "navbar sheet-bar";
  const h1 = Object.assign(document.createElement("h1"), { className: "nav-title", textContent: title });
  const done = Object.assign(document.createElement("button"), { type: "button", className: "bar-button done", textContent: "Done" });
  const spacer = document.createElement("div");
  const right = document.createElement("div");
  right.className = "sheet-right";
  right.append(done);
  const row = document.createElement("div");
  row.className = "sheet-bar-row";
  row.append(spacer, h1, right);
  bar.append(row);

  const content = document.createElement("div");
  content.className = "sheet-body";
  if (body) content.append(body);
  sheet.append(bar, content);
  document.body.append(sheet);

  const ease = "cubic-bezier(.25,.1,.25,1)";
  sheet.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 350, easing: ease });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    const a = sheet.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 300, easing: ease, fill: "forwards" });
    const end = () => { sheet.remove(); onClose(); };
    a.finished.then(end, end);
  }
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  done.addEventListener("click", close);
  done.focus({ preventScroll: true });
  return close;
}
