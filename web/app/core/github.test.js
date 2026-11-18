// F44: GitHub-hosted sources: the user/repo parse, and the title, subtitle and icon fallbacks built on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { githubRepo, displayName, sourceSubtitle, githubAvatarUrl, sourceIcons, DEFAULT_ALT_SOURCES } from "./sources.js";
import { seedRecord, altKey } from "./altstore.js";

test("githubRepo reads the four URL shapes", () => {
  assert.deepEqual(githubRepo("https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json"), { user: "chachillie", repo: "Flycast-iOS" });
  assert.deepEqual(githubRepo("https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json"), { user: "claration", repo: "Feather" });
  assert.deepEqual(githubRepo("https://fizl0.github.io/apps/source.json"), { user: "fizl0", repo: "apps" });
  assert.deepEqual(githubRepo("https://github.com/FIZL0/opentennis/releases/latest/download/altstore-source.json"), { user: "FIZL0", repo: "opentennis" });
  assert.deepEqual(githubRepo("https://github.com/FIZL0/openmx/releases/download/v1.2/altstore-source.json"), { user: "FIZL0", repo: "openmx" });
});

test("githubRepo: edge cases and non-GitHub hosts", () => {
  assert.deepEqual(githubRepo("https://xitrix.github.io/source.json"), { user: "xitrix", repo: null });
  assert.deepEqual(githubRepo("https://XITRIX.GitHub.io/iTorrent/AltStore.json"), { user: "xitrix", repo: "iTorrent" });
  assert.deepEqual(githubRepo("https://github.com/a/b.git"), { user: "a", repo: "b" });
  assert.equal(githubRepo("https://github.com/FIZL0"), null);
  assert.equal(githubRepo("https://github.com/orgs/foo/repos"), null);
  assert.equal(githubRepo("https://provenance-emu.com/apps.json"), null);
  assert.equal(githubRepo("https://notgithub.com/a/b/raw/x.json"), null);
  assert.equal(githubRepo("https://evil.github.io.example.com/a/b.json"), null);
  assert.equal(githubRepo("ftp://github.com/a/b"), null);
  assert.equal(githubRepo("not a url"), null);
  assert.equal(githubRepo(undefined), null);
});

test("title: the GitHub user while the source has no name of its own", () => {
  const seed = seedRecord("https://github.com/FIZL0/partyboard/releases/latest/download/altstore-source.json");
  assert.equal(displayName(seed), "FIZL0");
  assert.equal(displayName(seedRecord("https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json")), "claration");
  assert.equal(displayName(seedRecord("https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json")), "chachillie");
  assert.equal(displayName(seedRecord("https://fizl0.github.io/apps/source.json")), "fizl0");
  // Its own name wins once it has one; a failed load (name still null) keeps the user.
  assert.equal(displayName({ ...seed, name: "Partyboard" }), "Partyboard");
  assert.equal(displayName({ ...seed, updated: 1, error: "timeout" }), "FIZL0");
  // Non-GitHub hosts keep the host; an APT origin still wins over the GitHub user.
  assert.equal(displayName(seedRecord("https://source.ryuksign.com/source.json")), "source.ryuksign.com");
  assert.equal(displayName({ key: "deb:https://u.github.io/repo/:./", uri: "https://u.github.io/repo/", dist: "./", origin: "U Repo" }), "U Repo");
});

test("subtitle: github.com/<user>/<repo> instead of the raw URL", () => {
  assert.equal(sourceSubtitle(seedRecord("https://raw.githubusercontent.com/claration/Feather/refs/heads/main/app-repo.json")), "github.com/claration/Feather");
  assert.equal(sourceSubtitle(seedRecord("https://github.com/FIZL0/openmx/releases/latest/download/altstore-source.json")), "github.com/FIZL0/openmx");
  assert.equal(sourceSubtitle(seedRecord("https://fizl0.github.io/apps/source.json")), "github.com/fizl0/apps");
  assert.equal(sourceSubtitle(seedRecord("https://xitrix.github.io/source.json")), "xitrix.github.io");
  assert.equal(sourceSubtitle(seedRecord("https://repo.unbound.rip/app-repo.json")), "https://repo.unbound.rip/app-repo.json");
});

test("icon: the GitHub avatar when the source gives none of its own", () => {
  const url = "https://github.com/chachillie/Flycast-iOS/raw/main/flycast-ios.json";
  const avatar = "https://github.com/chachillie.png?size=120";
  assert.equal(githubAvatarUrl(seedRecord(url)), avatar);
  assert.deepEqual(sourceIcons(seedRecord(url)), [avatar]);
  assert.deepEqual(sourceIcons({ ...seedRecord(url), iconURL: "https://cdn.test/icon.png" }), ["https://cdn.test/icon.png"]);
  // Not on GitHub, no icon: nothing (the letter stays).
  assert.deepEqual(sourceIcons(seedRecord("https://alt.crystall1ne.dev/")), []);
  assert.equal(githubAvatarUrl(seedRecord("https://alt.crystall1ne.dev/")), null);
  // An APT repo on GitHub Pages: CydiaIcon.png first, the avatar when that fails.
  const apt = { key: "deb:https://someone.github.io/repo/:./", uri: "https://someone.github.io/repo/", dist: "./", components: [] };
  assert.deepEqual(sourceIcons(apt), ["https://someone.github.io/repo/CydiaIcon.png", "https://github.com/someone.png?size=120"]);
  assert.deepEqual(sourceIcons({ key: "deb:https://repo.chariz.com/:./", uri: "https://repo.chariz.com/", dist: "./", components: [] }), ["https://repo.chariz.com/CydiaIcon.png"]);
});

test("the F28 defaults: every GitHub-hosted one gets a user title and a short subtitle", () => {
  const gh = DEFAULT_ALT_SOURCES.filter((u) => githubRepo(u));
  assert.equal(gh.length, 6); // main dropped the three FIZL0 release-URL defaults (c8f4846); I7 added iFizBox's own
  for (const u of gh) {
    const s = seedRecord(u);
    assert.equal(s.key, altKey(u));
    assert.notEqual(displayName(s), new URL(u).hostname);
    assert.match(sourceSubtitle(s), /^github\.com\/[^/]+\/[^/]+$/);
  }
});
