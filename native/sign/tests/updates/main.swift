// Swift tests for I3's background update check (native/sign/Updates.swift), run on Linux by native/test_updates.py:
// the notification's text, dpkg version order, reading an AltStore source for this phone, and which updates are new.
//   updatestest
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

var failures = 0
var current = ""
func check(_ ok: Bool, _ what: @autoclosure () -> String, line: Int = #line) {
    if !ok { failures += 1; print("FAIL \(current) (line \(line)): \(what())") }
}
func test(_ name: String, _ body: () throws -> Void) {
    current = name
    let before = failures
    do { try body() } catch { failures += 1; print("FAIL \(name): threw \(error)") }
    print(failures == before ? "ok   \(name)" : "FAIL \(name)")
}
func found(_ id: String, _ name: String, _ from: String, _ to: String) -> UpdateCheck.Found {
    UpdateCheck.Found(id: id, name: name, installed: from, version: to)
}

test("notification text") {
    check(UpdateCheck.title(1) == "1 Update", UpdateCheck.title(1))
    check(UpdateCheck.title(2) == "2 Updates", UpdateCheck.title(2))
    check(UpdateCheck.title(12) == "12 Updates", UpdateCheck.title(12))
    let d = found("d", "Delta", "1.5", "1.6"), u = found("u", "UTM", "4.4", "4.5"), p = found("p", "PPSSPP", "1", "2"),
        q = found("q", "Provenance", "3", "3.1")
    check(UpdateCheck.body([]) == "", UpdateCheck.body([]))
    check(UpdateCheck.body([d]) == "Delta 1.6", UpdateCheck.body([d]))
    check(UpdateCheck.body([d, u]) == "Delta 1.6 and UTM 4.5", UpdateCheck.body([d, u]))
    check(UpdateCheck.body([d, u, p]) == "Delta 1.6, UTM 4.5 and PPSSPP 2", UpdateCheck.body([d, u, p]))
    check(UpdateCheck.body([d, u, p, q]) == "Delta 1.6, UTM 4.5 and 2 more", UpdateCheck.body([d, u, p, q]))
}

test("dpkg version order, as web/app/core/apt.js") {
    let cases: [(String, String, Int)] = [
        ("1.0", "1.0", 0), ("1.10", "1.9", 1), ("1.9", "1.10", -1), ("2.0~b1", "2.0", -1), ("2.0b1", "2.0", 1),
        ("1:0.1", "9.9", 1), ("1.0-2", "1.0-10", -1), ("1.0", "1.0-0", 0), ("01.2", "1.2", 0), (" 1.2 ", "1.2", 0),
        ("1.2.0", "1.2", 1), ("1.2a", "1.2+", -1), ("", "0", 0),
    ]
    for (a, b, want) in cases {
        check(DebVersion.compare(a, b) == want, "\(a) vs \(b): \(DebVersion.compare(a, b)), want \(want)")
        check(DebVersion.compare(b, a) == -want, "\(b) vs \(a): \(DebVersion.compare(b, a)), want \(-want)")
    }
}

let source = """
{"name": "A", "apps": [
  {"name": "Delta", "bundleIdentifier": "com.rileytestut.Delta", "versions": [
    {"version": "1.7", "minOSVersion": "99.0", "downloadURL": "https://a.example/d17.ipa"},
    {"version": "1.6", "minOSVersion": "14.0", "downloadURL": "https://a.example/d16.ipa"},
    {"version": "1.5", "downloadURL": "https://a.example/d15.ipa"}]},
  {"name": "Old Style", "bundleIdentifier": "old.style", "version": "2.1", "downloadURL": "https://a.example/o.ipa"},
  {"name": "Capped", "bundleIdentifier": "capped", "versions": [
    {"version": "3", "maxOSVersion": "16", "downloadURL": "https://a.example/c3.ipa"}]},
  {"name": "Marketing", "bundleIdentifier": "mkt", "versions": [{"marketingVersion": "5.0", "downloadURL": "https://a.example/m.ipa"}]},
  {"name": "Twice", "bundleIdentifier": "twice", "versions": [{"version": "1.0"}]},
  {"name": "Twice (beta)", "bundleIdentifier": "twice", "versions": [{"version": "1.2"}]},
  {"name": "No id", "versions": [{"version": "1"}]},
  "junk"
]}
"""

test("an AltStore source read for this phone") {
    let o = UpdateCheck.offers(Data(source.utf8), ios: "17.4")
    check(o["com.rileytestut.Delta"]?.version == "1.6", "Delta: \(String(describing: o["com.rileytestut.Delta"]))")
    check(o["old.style"]?.version == "2.1", "1.x app: \(String(describing: o["old.style"]))")
    check(o["capped"] == nil, "maxOSVersion 16 doesn't run on 17.4")
    check(UpdateCheck.offers(Data(source.utf8), ios: "16.7.2")["capped"]?.version == "3", "16.7.2 is within 16")
    check(o["mkt"]?.version == "5.0", "marketingVersion")
    check(o["twice"]?.version == "1.2", "the newer of an id listed twice")
    check(o.count == 4, "count \(o.count)")
    check(UpdateCheck.offers(Data("not json".utf8), ios: "17.0").isEmpty, "bad JSON")
    check(UpdateCheck.offers(Data("[1,2]".utf8), ios: "17.0").isEmpty, "no apps")
    check(UpdateCheck.offers(Data(source.utf8), ios: nil)["com.rileytestut.Delta"]?.version == "1.7", "no iOS: everything runs")
}

test("remembered versions against the sources: updates, and which are new") {
    let s = "https://a.example/apps.json"
    let page: [Any] = [
        ["id": "com.rileytestut.Delta", "name": "Delta", "version": "1.5", "source": s],
        ["id": "old.style", "name": "Old Style", "version": "2.1", "source": s], // same version: no update
        ["id": "mkt", "name": "Marketing", "version": "4.9", "source": "https://b.example/other.json"], // that source failed
        ["id": "twice", "version": "1.0", "source": s], // no name: the id
        ["id": "bad", "name": "Bad", "version": "1", "source": "javascript:alert(1)"],
        ["name": "No id", "version": "1", "source": s],
        "junk",
    ]
    let w = UpdateCheck.watched(page)
    check(w.map(\.id) == ["com.rileytestut.Delta", "old.style", "mkt", "twice"], "watched \(w.map(\.id))")
    check(w[3].name == "twice", w[3].name)
    let offers = [s: UpdateCheck.offers(Data(source.utf8), ios: "17.4")]
    let u = UpdateCheck.updates(w, offers: offers)
    check(u == [found("com.rileytestut.Delta", "Delta", "1.5", "1.6"), found("twice", "twice", "1.0", "1.2")], "updates \(u)")
    let fresh = UpdateCheck.fresh(u, known: ["twice 1.2"])
    check(fresh.map(\.id) == ["com.rileytestut.Delta"], "fresh \(fresh.map(\.id))")
    check(UpdateCheck.fresh(u, known: ["com.rileytestut.Delta 1.6", "twice 1.2"]).isEmpty, "all known")
    check(UpdateCheck.fresh(u, known: ["com.rileytestut.Delta 1.5"]).count == 2, "an older known version doesn't count")
    // Round trip through the store BackgroundCheck keeps in UserDefaults.
    let data = try JSONEncoder().encode(w)
    check(try JSONDecoder().decode([UpdateCheck.Watched].self, from: data) == w, "Codable round trip")
}

test("known updates after the page sends a new watch list") {
    let s = "https://a.example/apps.json"
    let d15 = UpdateCheck.Watched(id: "d", name: "Delta", version: "1.5", source: s)
    let u1 = UpdateCheck.Watched(id: "u", name: "UTM", version: "1", source: s)
    // Delta's 1.6 was notified; the page's load missed it (its source failed): still known.
    var k = UpdateCheck.mergeKnown(old: ["d 1.6", "u 2"], oldWatch: [d15, u1], page: [], newWatch: [d15, u1])
    check(k == ["d 1.6", "u 2"], "kept \(k)")
    // Delta 1.6 installed (remembered 1.6 now): its old key goes; UTM forgotten (Mark as Not Installed): its key goes.
    let d16 = UpdateCheck.Watched(id: "d", name: "Delta", version: "1.6", source: s)
    k = UpdateCheck.mergeKnown(old: ["d 1.6", "u 2"], oldWatch: [d15, u1], page: ["x 3"], newWatch: [d16])
    check(k == ["x 3"], "dropped \(k)")
    check(UpdateCheck.mergeKnown(old: ["junk"], oldWatch: [], page: [], newWatch: [d15]).isEmpty, "a key without a space")
}

test("B47: the icon badge is Changes' last count plus updates it didn't count") {
    func f(_ id: String, _ v: String) -> UpdateCheck.Found { found(id, id, "1", v) }
    // Changes counted Delta 1.6 and a re-sign (2): Delta 1.7 found now is the same row, UTM is new.
    check(UpdateCheck.badge([f("d", "1.7"), f("u", "2")], pageCount: 2, pageKeys: ["d 1.6"]) == 3, "newer version of a counted row")
    // Nothing found (a source failed in the background): Changes' count stands, never 0 by accident.
    check(UpdateCheck.badge([], pageCount: 2, pageKeys: ["d 1.6"]) == 2, "nothing found")
    // Changes showed nothing and nothing is found: no badge (before, an ignored or removed app could count here).
    check(UpdateCheck.badge([], pageCount: 0, pageKeys: []) == 0, "up to date")
    check(UpdateCheck.badge([f("d", "1.6")], pageCount: 1, pageKeys: ["d 1.6"]) == 1, "the counted row itself")
    check(UpdateCheck.badge([f("d", "1.6")], pageCount: -3, pageKeys: ["junk"]) == 1, "a bad count or key")
}

test("B207: a posted notice always carries a badge for what it tells of") {
    let f = { (id: String, v: String) in found(id, id, "1", v) }
    // Changes showed nothing (Delta 1.6 ignored, F281, but its key known); Delta 1.7 is a fresh notice: badge 1, not 0.
    let known: Set<String> = ["d 1.6"]
    let d17 = [f("d", "1.7")]
    check(UpdateCheck.badge(d17, pageCount: 0, pageKeys: known) == 0, "the old math left 0")
    check(UpdateCheck.noticeBadge(d17, fresh: UpdateCheck.fresh(d17, known: known), pageCount: 0, pageKeys: known) == 1,
          "the notice's badge counts its update")
    // With `counted` sent apart from `known`, the ignored key no longer stands for a counted row.
    let page = UpdateCheck.pageKeys(known: known, counted: [] as [Any])
    check(page.isEmpty, "counted: \(page)")
    check(UpdateCheck.badge(d17, pageCount: 0, pageKeys: page) == 1, "badge from counted keys")
    // Two counted rows and an ignored third: its next version adds one.
    let p2 = UpdateCheck.pageKeys(known: ["a 2", "b 3", "d 1.6"], counted: ["a 2", "b 3", 7] as [Any])
    check(p2 == ["a 2", "b 3"], "bad entries dropped: \(p2)")
    let all = [f("a", "2"), f("b", "3"), f("d", "1.7")]
    check(UpdateCheck.noticeBadge(all, fresh: [f("d", "1.7")], pageCount: 2, pageKeys: p2) == 3, "2 counted + the new one")
    // No `counted` (an older page): `known` as before.
    check(UpdateCheck.pageKeys(known: known, counted: nil) == known, "fallback")
    // A newer version of a counted row is still the same row; nothing fresh, nothing added.
    check(UpdateCheck.noticeBadge([f("a", "2.1")], fresh: [], pageCount: 1, pageKeys: ["a 2"]) == 1, "same row")
    // Changes' own count larger than the fresh ones wins.
    check(UpdateCheck.noticeBadge([f("a", "2.1")], fresh: [f("a", "2.1")], pageCount: 4, pageKeys: ["a 2"]) == 4, "page count")
}

test("B124: the app's own update handed to iOS comes off the badge") {
    let me: Set<String> = ["com.ryha.ifizbox", "com.ryha.ifizbox.ABCDE12345"]
    // Changes counted iFizBox 0.12.0 and Delta: 1 left.
    var c = UpdateCheck.Counts(pageCount: 2, pageKeys: ["com.ryha.ifizbox 0.12.0", "d 1.6"], found: [])
    check(c.badge == 2, "before")
    var w = UpdateCheck.without(me, c)
    check(w.badge == 1 && w.pageCount == 1 && w.pageKeys == ["d 1.6"], "Changes' row: \(w)")
    // Only iFizBox waited: 0, the badge goes.
    c = UpdateCheck.Counts(pageCount: 1, pageKeys: ["com.ryha.ifizbox 0.12.0"], found: [])
    check(UpdateCheck.without(me, c).badge == 0, "only the app itself")
    // The background found it (Changes hadn't counted it), plus UTM: UTM stays.
    c = UpdateCheck.Counts(pageCount: 1, pageKeys: ["d 1.6"], found: ["com.ryha.ifizbox.ABCDE12345 0.12.0", "u 2", "d 1.7"])
    check(c.badge == 3, "background before: \(c.badge)")
    w = UpdateCheck.without(me, c)
    check(w.badge == 2 && w.found == ["u 2", "d 1.7"], "background find: \(w)")
    // iFizBox wasn't counted at all: nothing changes.
    c = UpdateCheck.Counts(pageCount: 2, pageKeys: ["d 1.6", "u 2"], found: ["u 3"])
    check(UpdateCheck.without(me, c) == c, "not counted")
    // A bad stored count never goes below 0.
    check(UpdateCheck.without(me, UpdateCheck.Counts(pageCount: 0, pageKeys: ["com.ryha.ifizbox 1"], found: [])).badge == 0, "0 stays 0")
    // The watch list moves iFizBox to the version handed off, never down, and leaves the rest.
    let watch = [UpdateCheck.Watched(id: "com.ryha.ifizbox", name: "Self", version: "0.11.0", source: "s"),
                 UpdateCheck.Watched(id: "d", name: "Delta", version: "1.5", source: "s")]
    let moved = UpdateCheck.handedOff(watch, ids: me, version: "0.12.0")
    check(moved[0].version == "0.12.0" && moved[1] == watch[1], "watch moved: \(moved)")
    check(UpdateCheck.handedOff(moved, ids: me, version: "0.11.5")[0].version == "0.12.0", "never lowered")
    // and a background run with the source still at 0.12.0 finds nothing for iFizBox
    let offers = ["s": ["com.ryha.ifizbox": UpdateCheck.Offer(name: "Self", version: "0.12.0")]]
    check(UpdateCheck.updates(moved, offers: offers).isEmpty, "no second find")
}

test("B158: the icon badge is the latest count, set one at a time") {
    // The page's launch counts: a 0 (before iFizBox's own row was read, or the first launch after an update) then
    // Changes' 1. Whichever permission check answers first, the icon ends at 1.
    var s = UpdateCheck.BadgeSync()
    s.want(0)
    s.want(1)
    check(s.start() == 1, "the latest count is set")
    check(s.start() == nil, "the older call has nothing left to set")
    check(s.done() == nil && !s.busy, "idle after")
    // A count arriving while iOS is still setting the last one is set right after it, never before.
    s.want(1)
    check(s.start() == 1, "first")
    s.want(0)
    check(s.start() == nil, "waits for the one in flight")
    s.want(2)
    check(s.done() == 2, "then the latest: \(s)")
    check(s.done() == nil, "then nothing")
    // The same count again is set again (the background run or a delivered notification may have changed the icon).
    s.want(1); check(s.start() == 1, "set"); check(s.done() == nil, "done")
    s.want(1); check(s.start() == 1, "set again")
    _ = s.done()
    // A bad count is 0, never negative.
    s.want(-4); check(s.start() == 0, "clamped")
    // Changes' count with iFizBox's own update in it reaches the icon: the count is what the page sends.
    var c = UpdateCheck.Counts(pageCount: 1, pageKeys: ["com.ryha.ifizbox 0.13.0"], found: [])
    s = UpdateCheck.BadgeSync()
    s.want(c.badge)
    check(s.start() == 1, "the app's own update badges the icon")
    // and only a hand-off to iOS takes it off
    c = UpdateCheck.without(["com.ryha.ifizbox"], c)
    s.want(c.badge)
    check(s.done() == 0, "handed off: 0")
}

test("B264: each app's re-sign or install handed to iOS takes its Changes row off the icon badge") {
    // Changes counted 5: two updates (Alpha, Beta) and three re-signs (Gamma, Delta, Echo).
    let c = UpdateCheck.Counts(pageCount: 5, pageKeys: ["alpha 2.0", "beta 3.1"], found: [])
    let resign: Set<String> = ["gamma", "delta", "echo"]
    // a re-sign of Gamma: 4, Gamma no longer among the re-sign rows
    var r = UpdateCheck.afterHandOff(["gamma", "gamma.src"], version: "1.0", c, resign: resign)
    check(r.counts.badge == 4 && r.resign == ["delta", "echo"], "re-signed: \(r)")
    // then Delta and Echo: 2 (the updates stay)
    r = UpdateCheck.afterHandOff(["delta"], version: "1", r.counts, resign: r.resign)
    r = UpdateCheck.afterHandOff(["echo"], version: "1", r.counts, resign: r.resign)
    check(r.counts.badge == 2 && r.resign.isEmpty && r.counts.pageKeys.count == 2, "both: \(r)")
    // Alpha's update installed (by its source's ID): 1
    r = UpdateCheck.afterHandOff(["alpha.signed", "alpha"], version: "2.0", r.counts, resign: r.resign)
    check(r.counts.badge == 1 && r.counts.pageKeys == ["beta 3.1"], "updated: \(r)")
    // a re-sign of Beta (still 3.0) leaves its 3.1 update counted
    let kept = UpdateCheck.afterHandOff(["beta"], version: "3.0", r.counts, resign: r.resign)
    check(kept.counts == r.counts, "a re-sign keeps the update: \(kept)")
    // a newer version than the counted update also ends it; the same app twice counts once
    r = UpdateCheck.afterHandOff(["beta"], version: "3.2", r.counts, resign: ["beta"])
    check(r.counts.badge == 0 && r.resign.isEmpty, "one row: \(r)")
    // an app Changes didn't count changes nothing; 0 stays 0
    check(UpdateCheck.afterHandOff(["other"], version: "9", c, resign: resign).counts == c, "not counted")
    let zero = UpdateCheck.Counts(pageCount: 0, pageKeys: [], found: [])
    check(UpdateCheck.afterHandOff(["gamma"], version: "1", zero, resign: ["gamma"]).counts.badge == 0, "never negative")
    // a background find of the same update goes too
    let bg = UpdateCheck.Counts(pageCount: 0, pageKeys: [], found: ["alpha 2.0"])
    check(UpdateCheck.afterHandOff(["alpha"], version: "2.0", bg, resign: []).counts.badge == 0, "found: gone")
}

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
