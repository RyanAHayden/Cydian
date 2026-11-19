// R26: run the website's real signing job (websign-job.js + vendor/zsign WebAssembly) on OUTDIR/test.ipa with
// OUTDIR/key.p12 and OUTDIR/profile.mobileprovision, but with the job's extension removal turned off, so the output
// shows what zsign does to an app extension. Usage: node sign.mjs REPO OUTDIR [keep|old] [prof]
// prof: also copy the app's profile into each PlugIns/*.appex as embedded.mobileprovision before zsign seals it
// (zsign writes one into an extension only when one of several -m profiles matches the extension's ID).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [repo, out, mode = "keep", prof = ""] = process.argv.slice(2);
const { runSignJob } = await import(pathToFileURL(`${repo}/web/app/websign-job.js`));
const { default: real } = await import(pathToFileURL(`${repo}/web/app/vendor/zsign/zsign.js`));
const rd = (n) => new Uint8Array(readFileSync(`${out}/${n}`));

// removeTree (rmdir/unlink on PlugIns, Extensions, Watch) runs before callMain: make those no-ops until zsign starts.
const createZsign = async (o) => {
  const zs = await real(o);
  const { FS } = zs;
  const rmdir = FS.rmdir, unlink = FS.unlink;
  const kept = (p) => /\/(PlugIns|Extensions|Watch)(\/|$)/.test(p);
  FS.rmdir = (p) => (kept(p) ? undefined : rmdir.call(FS, p));
  FS.unlink = (p) => (kept(p) ? undefined : unlink.call(FS, p));
  const main = zs.callMain;
  zs.callMain = (args) => {
    FS.rmdir = rmdir; FS.unlink = unlink;
    if (prof === "prof") {
      const app = args[args.length - 1];
      let exts = [];
      try { exts = FS.readdir(`${app}/PlugIns`).filter((n) => n.endsWith(".appex")); } catch { /* none */ }
      for (const e of exts) FS.writeFile(`${app}/PlugIns/${e}/embedded.mobileprovision`, FS.readFile("/w/app.mobileprovision"));
    }
    console.error("zsign", args.join(" "));
    return main(args);
  };
  return zs;
};
const r = await runSignJob(createZsign, { ipa: rd("test.ipa"), p12: rd("key.p12"), password: "hunter2",
  profile: rd("profile.mobileprovision"), keepBundleId: mode === "keep" });
writeFileSync(`${out}/signed-${mode}${prof ? "-" + prof : ""}.ipa`, r.ipa);
console.log(JSON.stringify({ bundleId: r.bundleId, originalId: r.originalId, bytes: r.ipa.length }));
