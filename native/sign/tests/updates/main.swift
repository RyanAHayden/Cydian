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

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
