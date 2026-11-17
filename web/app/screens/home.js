// Home tab. Placeholder content until the real Home lands; it shows the grouped-table style and a push.
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";

export const title = "Home";

export function nav(route, ctx) {
  if (route.path[0] === "about") return { title: "About" };
  return { title: "Cydian", left: { label: "About", onClick: () => showAbout(ctx) } };
}

// Cydia-style About popup from the nav bar's About button (nav/alert.js, the same UIAlertView as Add Source).
async function showAbout(ctx) {
  const { index } = await ctx.showAlert({
    title: "About Cydian",
    message: "A package manager with the iOS 6 look, for modern iPhones. Free and open source (GPL-3.0).",
    buttons: ["Settings", "OK"], cancel: 0,
  });
  if (index === 0) ctx.go({ tab: "settings", path: [] });
}

export function render(el, route) {
  if (route.path[0] === "about") {
    el.append(grouped([
      { header: "Cydian", rows: [{ label: "Version", detail: "0.1" }, { label: "License", detail: "GPL-3.0+" }] },
      { footer: "A package manager with the iOS 6 look, for modern iPhones." },
    ]));
    return;
  }
  el.append(grouped([
    { rows: [{ label: "Welcome to Cydian" }], footer: "Add a source in Sources, then browse its packages." },
    { header: "More", rows: [{ label: "About Cydian", href: format({ tab: "home", path: ["about"] }) }] },
  ]));
}
