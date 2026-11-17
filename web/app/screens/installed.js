// Installed tab. Placeholder until the package list lands: a plain list with alphabet section headers.
import { plain } from "../nav/ui.js";

export const title = "Installed";

const SAMPLE = { A: ["apt", "apt-key"], B: ["base", "bash", "bzip2"], C: ["coreutils"], D: ["darwintools", "debianutils", "diffutils", "dpkg"] };

export function nav() {
  return { title: "Installed", style: "plain" };
}

export function render(el) {
  el.append(plain(Object.entries(SAMPLE).map(([letter, names]) => ({
    header: letter, rows: names.map((n) => ({ label: n, subtitle: "Sample row" })),
  }))));
}
