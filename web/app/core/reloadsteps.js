// F150: the words of the drop-down reload bar (nav/reloadbar.js) as a refresh goes on, as Cydia's bar changes them.
// Pure: the Sources screen feeds it what happens and shows what text() says.
//
//   const steps = reloadSteps(sources, { apt: true, onText: (t) => bar.set(t) });
//   steps.each(record)   // a source answered: from the first answer on, "Downloading Packages"
//   steps.load()         // the package lists go into the catalog
//   steps.cache()        // the catalog's lists (Changes, search) are worked out
//
// Order: "Updating Sources" while the sources' Release/Packages and AltStore JSON are first fetched (apt-get update
// in the jailbreak app), "Downloading Packages" once the first source has answered and the rest come in, then
// "Loading Data", then "Building Searcher Cache".
// F179: only these four fixed words, never a source's name, URL or a count: the per-source text flickered past
// unreadably (the bar also holds each step on screen for a minimum time, nav/reloadbar.js). `apt` and `name` are
// still taken, and ignored, so callers need no change.

export const STEP_TEXT = Object.freeze({
  update: "Updating Sources",
  download: "Downloading Packages",
  load: "Loading Data",
  cache: "Building Searcher Cache",
});

export function reloadSteps(list, { onText = () => {} } = {}) {
  const pending = (Array.isArray(list) ? list : []).filter(Boolean);
  let phase = pending.length ? "update" : "download";
  const text = () => STEP_TEXT[phase];
  let last = null;
  const emit = () => {
    const t = text();
    if (t !== last) { last = t; onText(t); }
  };
  emit();
  return {
    text,
    get phase() { return phase; },
    each() {
      if (phase === "update") phase = "download";
      if (phase === "download") emit();
    },
    load() { phase = "load"; emit(); },
    cache() { phase = "cache"; emit(); },
  };
}
