# B101: wrangler dev refused the Worker's entry

## What happened

- Reproduced: `npx wrangler dev -c wrangler.toml --local` stopped with workerd's
  `Uncaught TypeError: Incorrect type for map entry 'HOST_WAIT': the provided value is not of type 'function or ExportedHandler'`.
  src/index.js exports plain values (HOST_WAIT, PART, MANIFEST_WAIT, ...) for worker/test.mjs and node.mjs.
- Real deploy: not broken. ifizbox.com/healthz answered 200 (Workers Builds deploys src/index.js as main on
  every push), so Cloudflare's edge accepts the extra exports. Only local workerd refuses them.
- Fix: `worker/entry.js` re-exports only `default` from src/index.js (the same approach as preview-entry.js).
  `main` in wrangler.toml and wrangler.ifizbox.toml now points at it. index.js is unchanged, so the tests and
  node.mjs keep their imports.
- `worker/test_entry.py` (gate): every `wrangler*.toml`'s main must exist and contain only
  `export { default } from "./src/index.js";`. It would have failed on the old `main = "src/index.js"`.

## Checked

- `wrangler dev --local` on wrangler.toml (port 8791) and wrangler.ifizbox.toml (port 8792): "Ready", `/healthz` 200,
  `/` 200 (assets).
- `wrangler deploy --dry-run -c wrangler.ifizbox.toml --outdir …`: bundles, and the bundle's only export is `default`.

## What failed

- The first `done` failed the gate: native/test_brand.py walks the disk and read the bundles `wrangler dev` left
  in worker/.wrangler/tmp/ (git-ignored), which contain brand.js's name. I deleted worker/.wrangler and filed T20 to
  make the test skip ignored build output, because that test file is outside this task. Until T20 lands, delete
  worker/.wrangler after a local `wrangler dev` and before running the gate.

## Not verified

- A real deploy with the new entry: deploys happen through Workers Builds on the push to main after the merge, and
  publishing by hand is outside this task. The dry-run bundle shows the same handler code with fewer exports, so it
  should be no riskier than before.
