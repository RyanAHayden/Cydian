// Sources tab. Placeholder until F4: the default sources as a plain list (the rows push a detail screen), with
// Cydia's Refresh (shows the Reloading Data HUD) and Edit buttons. Nothing is fetched or saved yet.
import { grouped, plain } from "../nav/ui.js";
import { format } from "../router.js";

export const title = "Sources";

const DEFAULTS = [
  ["Telesphoreo", "http://apt.saurik.com/"],
  ["BigBoss", "http://apt.thebigboss.org/repofiles/cydia/"],
  ["Chariz", "https://repo.chariz.com/"],
  ["Havoc", "https://havoc.app/"],
  ["Procursus", "https://apt.procurs.us/"],
];

export function nav(route, ctx) {
  if (route.path.length) {
    const s = DEFAULTS.find(([, url]) => url === route.path[0]);
    return { title: s ? s[0] : "Source" };
  }
  return {
    title: "Sources", style: "plain",
    left: { label: "Refresh", onClick: () => { const hide = ctx.showHUD("Reloading Data"); setTimeout(hide, 1500); } },
    right: { label: "Edit" },
  };
}

export function render(el, route) {
  if (route.path.length) {
    el.append(grouped([{ header: "Source", rows: [{ label: "URL", detail: route.path[0] }] }]));
    return;
  }
  el.append(plain([{
    header: "Default sources",
    rows: DEFAULTS.map(([name, url]) => ({
      label: name, subtitle: url, icon: { text: name[0] }, href: format({ tab: "sources", path: [url] }),
    })),
  }]));
}
