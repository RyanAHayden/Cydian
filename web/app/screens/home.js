// Home tab. Placeholder content until the real Home lands; it shows the grouped-table style and a push.
import { grouped } from "../nav/ui.js";
import { format } from "../router.js";

export const title = "Home";

export function nav(route, ctx) {
  if (route.path[0] === "about") return { title: "About" };
  return { title: "Cydian", left: { label: "About", onClick: () => showAbout(ctx) } };
}

// About, laid out like Cydia's on the 4S (ref/4s/screens/cydia-about.png): centred lines in groups with a blank line
// between them, and one wide Close button.
async function showAbout(ctx) {
  await ctx.showAlert({
    title: "About Cydian",
    message: "Version 0.1\nFree and open source (GPL-3.0)\n\nA package manager with the\niOS 6 look, for modern iPhones\ngithub.com/RyanAHayden/Cydian",
    buttons: ["Close"],
  });
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
