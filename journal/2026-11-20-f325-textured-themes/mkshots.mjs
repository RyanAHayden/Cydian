// Writes shots.json for capture.mjs: Home, Changes, Settings, a package page and an alert per F325 theme.
import { writeFileSync } from "node:fs";
const PKG = "#/sources/alt%3Ahttps%3A%2F%2Fprovenance-emu.com%2Fapps.json/package%3Acom.provenance-emu.provenance";
const themes = [["dark", "leather"], ["dark", "felt"], ["dark", "wood"], ["light", "legalpad"], ["light", "metal"]];
const steps = [{ wait: 2000 }, { eval: "localStorage.setItem('ifizbox.firstVisit','later'); 'ok'" }];
for (const [tone, p] of themes) {
  steps.push({ eval: `localStorage.setItem('ifizbox.appearance','${tone}'); localStorage.setItem('ifizbox.${tone}Theme','${p}'); 'ok'` });
  steps.push({ nav: "#/home", ms: 8000 });
  steps.push({ eval: "[document.documentElement.dataset.theme, document.documentElement.dataset.palette, document.querySelector('meta[name=theme-color]').content].join(' | ')" });
  steps.push({ shot: `${p}-home` });
  steps.push({ go: "#/changes", ms: 6000 }, { shot: `${p}-changes` });
  steps.push({ go: "#/home/settings", ms: 3000 }, { shot: `${p}-settings` });
  steps.push({ go: `#/home/settings/theme/${tone}Theme`, ms: 3000 }, { shot: `${p}-theme-list` });
  steps.push({ nav: PKG, ms: 12000 }, { shot: `${p}-package` });
  steps.push({ eval: "import('./nav/alert.js').then((m) => { m.showAlert({ title: 'Remove Source', message: 'Packages from this source will no longer be available.', buttons: ['Cancel', 'Remove'] }); return 'shown'; })" });
  steps.push({ wait: 1500 }, { shot: `${p}-alert` });
}
writeFileSync(process.argv[2], JSON.stringify(steps, null, 1));
