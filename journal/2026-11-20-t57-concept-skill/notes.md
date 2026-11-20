# T57: concept skill (live web/app concepts as Artifacts)

## What it is

- `.claude/skills/concept/SKILL.md`: how to make a concept (scratch worktree, change real screen code, build, check,
  publish with the Artifact tool) and the iOS 6 rules concepts must keep.
- `tools/concept/build.py`: packs a `web/app` (default this checkout's) into ONE self-contained HTML file (~5.5 MB):
  the app runs live in an iframe (srcdoc) inside a phone frame, with controls for theme (Light Classic by default,
  every palette from core/settings.js), device (iPhone SE, 14 notch, 15/16 island, 17 Pro Max, iPad mini), mode
  (jailbroken / Lite / website) and before/after against a git ref (default main; only differing modules, files and
  images are stored for "before").
- `tools/concept/esm.py`: stdlib ES module bundler. `tools/concept/shell.js`: the in-frame fake phone.
  `tools/concept/sample.py`: sample sources from repo fixtures. `tools/concept/check.mjs`: headless Chromium check
  under an Artifact-like CSP. `tools/concept/test_concept.py`: the gate test.

## Findings worth keeping

- The Artifact CSP rules (artifact-design skill): only a few CDNs for scripts, nothing fetched (connect-src none in
  effect), images data:/blob:. So everything is inline: JS bundled, CSS as text, images as data: URIs. Untested in
  the real viewer whether same-origin `files` scripts would load; inline needs no such assumption.
- Bundling without a parser: each module becomes `async function` whose body runs inside `with (imports)`; imports
  are getters on an `Object.create(null)` object, so bindings stay live and local shadowing still works. Exports are
  getters defined at the top of the with-block (block function declarations are hoisted, `const` is lazy). Every
  module async = top-level await works (app.js uses it). The build checks every imported name is exported, which
  catches tokenizer slips. `node --check` and a bare `vm` load all 83 core/ modules.
- about:srcdoc: the router's `history.replaceState(null, "", "#/x")` resolves "#/x" against the BASE url (the parent
  page), which throws SecurityError; shell.js rewrites pushState/replaceState URLs to `about:srcdoc#frag`. Links to
  `#/x` would load the parent page in the frame: a capture-phase click handler sets location.hash instead.
- Chrome keeps CSS properties as own properties of each style object (not on CSSStyleDeclaration.prototype), so
  `el.style.backgroundImage = url("icons/…")` (browse.js section icons) can't be intercepted by a setter; a
  MutationObserver on `style` attributes rewrites them before the next style pass (no request seen in the check).
  Careful with the "already a data: URL" regex: `url\(\s*["']?(?!data:)` backtracks over the quote and matches
  `url("data:…")` again: an infinite observer loop. Use `url\(\s*(?!["']?data:)`.
- `data-shell="app"` (App.swift sets it in both builds) is what makes ios6.css paint the nav bar through the status
  bar strip; without it the app modes showed a black band under the status bar.
- `[hidden]` loses to an author `display: flex`: the hidden Safari bar still took 9px and the app's tab bar floated
  above a white strip. The frame page sets `[hidden] { display: none !important }`.
- Theme: Mode "Automatic" follows prefers-color-scheme, which would follow the viewer's OS in the Artifact; the
  frame seeds `ifizbox.appearance` explicitly so it opens light.
- The Artifact tool warns "this page offers a file through a download link": a false positive from the app's own
  export/save code inside the bundle.

## Checks run

- `node tools/concept/check.mjs` on the unchanged app: jailbreak, sideload and site x iPhone SE and 17 Pro Max x
  Light Classic and Dark Gunmetal (12 runs), plus iPad mini and iPhone 14 in Sepia: all clean (no exception,
  console.error, CSP refusal or request). Shots: `jailbreak-iphone-se-light-classic.png`,
  `site-iphone-17-pro-max-dark-gunmetal.png`.

## More Sources concept (F327), the first real use

Built in a scratch worktree on branch `concept/more-sources` (not merged anywhere): core/recommended.js tags the
modded app sources, icons/rowicons.js gets the `moreSources` tile (white plus on blue), Manage > Recommended's route
draws More Sources (Find Tweak Sources / Find App Sources with 40pt section icons and a green + badge, Recommended
header with Add All as a .bar-button, groups Tweak Sources / From the Developer / Modded Apps, ADD/ADDED as
.price-btn), the Sources tab has the More Sources row with a badge and Tweak Sources / App Sources groups, Home's row
is More Sources. Published: https://claude.ai/artifact/8iJtjFuAxKWKVp3yvUMEod ("More Sources Live").
Shot: `more-sources-concept-sources.png`.
