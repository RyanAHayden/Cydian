// Synthetic apt state for the F233 screenshots: 6 flat sources, 4 with lists, 2 that the fake update fails on.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const ok = { alpha: 412, beta: 87, gamma: 1530, delta: 23 };
const all = [...Object.keys(ok), "dead", "notfound"];
writeFileSync(join(dir, "etc/apt/sources.list.d/test.sources"),
  all.map((n) => `Types: deb\nURIs: https://${n}.test/\nSuites: ./\n`).join("\n"));
for (const [n, c] of Object.entries(ok)) {
  writeFileSync(join(dir, `var/lib/apt/lists/${n}.test_._Release`), `Origin: ${n[0].toUpperCase() + n.slice(1)} Repo\nLabel: ${n}\n`);
  let p = "";
  for (let i = 0; i < c; i++) p += `Package: com.${n}.pkg${i}\nVersion: 1.${i}\nArchitecture: iphoneos-arm64\nName: ${n} ${i}\nSection: Tweaks\n\n`;
  writeFileSync(join(dir, `var/lib/apt/lists/${n}.test_._Packages`), p);
}
writeFileSync(join(dir, "var/lib/dpkg/status"), "Package: firmware\nStatus: install ok installed\nVersion: 15.8\nArchitecture: iphoneos-arm64\n\n");
