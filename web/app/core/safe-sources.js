// Known-safe sources (F291, concept K2 option B, step 2): the sources a person has checked, marked Known Safe in
// Sources, Recommended and on app pages; Add Source asks nothing more for them. Everything else is Unknown until the
// user trusts it (core/trust.js). The list ships in the app, like core/piracy-list.js: nothing is fetched.
//
// Who decides: the maintainer, through a pull request with a public link as evidence. The bar: a known developer or
// team, a public repo or a long track record, and no reports. Recommended (core/recommended.js) is curated to that
// bar already, so every entry there is on this list by construction and the two can't drift apart; KNOWN_SAFE_EXTRA
// adds the ones Recommended doesn't show. No maintained public "safe AltStore sources" list exists to copy (checked
// 2026-11-20: AltStore, SideStore and Feather ship their own built-in and recommended sources, which Recommended
// already follows; Sileo and Zebra ship their default repos, also there). If one appears, a sync script can merge it
// as tools/sync-piracy-list.py does for Canister's piracy list.
//
// Matching is on a source's place: a GitHub-hosted source by its user and repo (github.com, raw.githubusercontent.com,
// <user>.github.io; core/sources.js githubRepo), anything else by its host (lower case, "www." dropped). Never a
// parent domain or a whole shared host: github.com itself is nobody's.
//
//   KNOWN_SAFE                -> [{ place, name, reason, link }]
//   placeOf(url)              -> "gh:<user>/<repo>" | "<host>" | null
//   knownSafe(input)          -> the entry for a source URL, key ({ uri }, deb:/alt: key) or record, else null
import { RECOMMENDED_SOURCES } from "./recommended.js";
import { githubRepo } from "./sources.js";
import { inputHost } from "./warnings.js";
import { DOMAIN, NAME } from "../brand.js";

// The ones Recommended doesn't list: dist repos it can't add, and the default sources app-sources.json ships.
export const KNOWN_SAFE_EXTRA = [
  { url: `https://${DOMAIN}/repo/`, name: NAME, reason: `${NAME}'s own source.`, link: `https://${DOMAIN}/` },
  { url: "https://apt.procurs.us/", name: "Procursus", reason: "The bootstrap every rootless jailbreak installs.", link: "https://github.com/ProcursusTeam/Procursus" },
  { url: "https://apt.thebigboss.org/", name: "BigBoss", reason: "The oldest tweak repo, one of Dopamine's defaults.", link: "https://github.com/opa334/Dopamine" },
  { url: "https://xitrix.github.io/iTorrent/AltStore.json", name: "iTorrent", reason: "An open-source torrent client, from its developer's own repo.", link: "https://github.com/XITRIX/iTorrent" },
];
// Not listed, on purpose (user 2026-11-20): AppTesters (repository.apptesters.org), a source of modded store apps.
// It was a default until then; people who added it keep it, shown as Unknown like any other source.

const hostOf = (url) => inputHost(url);

export function placeOf(input) {
  let s = input && typeof input === "object" ? input.uri ?? input.url ?? "" : String(input ?? "");
  s = s.trim();
  const key = /^deb:(.+):[^:]*$/.exec(s) || /^alt:(.+)$/.exec(s);
  if (key) s = key[1];
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  const gh = githubRepo(s);
  if (gh) return `gh:${gh.user.toLowerCase()}/${(gh.repo ?? "").toLowerCase()}`;
  return hostOf(s);
}

const recLink = (r) => {
  const gh = githubRepo(r.url);
  return gh?.repo ? `https://github.com/${gh.user}/${gh.repo}` : r.url;
};

export const KNOWN_SAFE = [
  ...KNOWN_SAFE_EXTRA.map((e) => ({ place: placeOf(e.url), name: e.name, reason: e.reason, link: e.link })),
  ...RECOMMENDED_SOURCES.filter((r) => r.kind === "source")
    .map((r) => ({ place: placeOf(r.url), name: r.name, reason: `In ${NAME}'s Recommended sources: ${r.why}`, link: recLink(r) })),
].filter((e) => e.place);

const BY_PLACE = new Map();
for (const e of KNOWN_SAFE) if (!BY_PLACE.has(e.place)) BY_PLACE.set(e.place, e);

export function knownSafe(input) {
  const place = placeOf(input);
  return place ? BY_PLACE.get(place) ?? null : null;
}
