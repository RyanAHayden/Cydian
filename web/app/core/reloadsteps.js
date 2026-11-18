// F150: the words of the drop-down reload bar (nav/reloadbar.js) as a refresh goes on, as Cydia's bar changes them.
// Pure: the Sources screen feeds it what happens and shows what text() says.
//
//   const steps = reloadSteps(sources, { apt: true, onText: (t) => bar.set(t) });
//   steps.each(record)   // a source answered: the next one still loading is named
//   steps.load()         // the package lists go into the catalog
//   steps.cache()        // the catalog's lists (Changes, search) are worked out
//
// Order: "Updating Sources" while apt-get update runs (the jailbreak app; nowhere else is there such a step), then
// "Downloading <source>" for the first source still loading ("Downloading Packages" when it has no name), then
// "Loading Data", then "Building Searcher Cache".

export const STEP_TEXT = Object.freeze({
  update: "Updating Sources",
  download: "Downloading Packages",
  load: "Loading Data",
  cache: "Building Searcher Cache",
});

const fallbackName = (s) => s?.name || s?.origin || s?.uri || "";

export function reloadSteps(list, { apt = false, name = fallbackName, onText = () => {} } = {}) {
  const pending = (Array.isArray(list) ? list : []).filter(Boolean);
  let phase = apt && pending.length ? "update" : "download";
  const text = () => {
    if (phase !== "download") return STEP_TEXT[phase];
    const who = pending.length ? String(name(pending[0]) ?? "").trim() : "";
    return who ? `Downloading ${who}` : STEP_TEXT.download;
  };
  let last = null;
  const emit = () => {
    const t = text();
    if (t !== last) { last = t; onText(t); }
  };
  emit();
  return {
    text,
    get phase() { return phase; },
    each(done) {
      const i = pending.findIndex((s) => s.key === done?.key);
      if (i >= 0) pending.splice(i, 1);
      if (phase === "update") phase = "download";
      if (phase === "download") emit();
    },
    load() { phase = "load"; emit(); },
    cache() { phase = "cache"; emit(); },
  };
}
