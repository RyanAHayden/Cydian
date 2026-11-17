"""Trim each downloaded source JSON into web/fixtures/altstore/<name>.json: every top-level field kept, apps cut
to `keep` (picked so each shape's quirk stays), each app's versions to 2, news to 2, long text cut to 160 chars."""
import json, sys
dl, out = sys.argv[1], sys.argv[2]
NAMES = {1: "provenance-emu", 2: "fizl0-apps", 3: "feather", 4: "flycast-ios", 5: "itorrent", 6: "crystall1ne",
         7: "apptesters", 8: "mountainofpenguin", 9: "ryuksign", 10: "unbound", 11: "opentennis",
         12: "partyboard", 13: "openmx"}
def cut(v):
    if isinstance(v, str): return v if len(v) <= 160 else v[:157] + "..."
    if isinstance(v, list): return [cut(x) for x in v[:3]]
    if isinstance(v, dict): return {k: cut(x) for k, x in v.items()}
    return v
for i, name in NAMES.items():
    j = json.load(open(f"{dl}/{'7b' if i == 7 else i}.json", encoding="utf-8-sig"))
    apps = j["apps"]
    if i == 7:  # ESign-style: one entry per version; keep the first three apps with every entry of the first
        first = apps[0]["bundleIdentifier"]
        ids = []
        for a in apps:
            if a["bundleIdentifier"] not in ids: ids.append(a["bundleIdentifier"])
            if len(ids) == 3: break
        keep = [a for a in apps if a["bundleIdentifier"] in ids][:6]
        # make sure a repeated bundle id is in there
        dup = next(a for a in apps if a["bundleIdentifier"] == "com.madarsoft.fitness")
        dups = [a for a in apps if a["bundleIdentifier"] == "com.madarsoft.fitness"][:2]
        keep = keep[:4] + dups
    elif i == 9:  # variants sharing bundle ids
        keep = apps[:4]
    else:
        keep = apps[:3]
    t = {k: v for k, v in j.items() if k not in ("apps", "news")}
    t = cut(t)
    t["apps"] = []
    for a in keep:
        a = dict(a)
        if isinstance(a.get("versions"), list): a["versions"] = a["versions"][:2]
        t["apps"].append(cut(a))
    if "news" in j: t["news"] = cut(j["news"][:2])
    with open(f"{out}/{name}.json", "w") as f:
        json.dump(t, f, indent=1, ensure_ascii=False); f.write("\n")
    print(name, len(t["apps"]), len(json.dumps(t)))
