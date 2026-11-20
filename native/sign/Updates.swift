// I3: the sideload app's background update check, the pure half (the Linux tests build it; BackgroundCheck.swift
// does the BGAppRefreshTask, URLSession and notification half). The page hands over the apps iFizBox remembers
// (web/app/app-updates.js, updates.watch): each with the version Install recorded and the AltStore source it came
// from. In the background each source is fetched and read like web/app/core/altstore.js reads it, and an app
// whose source now offers this phone a newer version is an update. The notification says "n Updates".
//
//   UpdateCheck.Watched           {id, name, version, source} as the page sends it
//   UpdateCheck.watched(_:)       the page's apps array -> [Watched] (bad entries dropped)
//   UpdateCheck.offers(_:ios:)    an AltStore source's JSON -> [bundle id: Offer]: the first version listed that
//                                 runs on `ios` (minOSVersion / maxOSVersion as altstore.js runsOn), per app
//   UpdateCheck.updates(_:offers:) the watched apps with a newer offer, as [Found], sorted by name
//   UpdateCheck.fresh(_:known:)   the ones not yet counted on screen or notified (key "<id> <version>")
//   UpdateCheck.mergeKnown(...)   the known keys after the page sends a new watch list
//   UpdateCheck.badge(_:pageCount:pageKeys:) the icon badge: Changes' last count plus updates it didn't count (B47)
//   UpdateCheck.Counts / without(_:_:) / handedOff(_:ids:version:) B124: the badge's parts once iFizBox has handed
//                                 iOS its own update, without that update's row
//   UpdateCheck.BadgeSync         B158: the icon badge set in order, the latest count only (Notifications.setIcon)
//   UpdateCheck.title(_:)     "1 Update" / "3 Updates" (app-updates.js updatesTitle)
//   UpdateCheck.body(_:)          "Delta 1.6" / "Delta 1.6 and UTM 4.5" / "Delta 1.6, UTM 4.5 and 2 more"
//   DebVersion.compare(_:_:)         -1, 0, 1 by dpkg's rules, as web/app/core/apt.js compareVersions
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum UpdateCheck {
    struct Watched: Codable, Equatable {
        let id: String
        let name: String
        let version: String
        let source: String
    }

    struct Offer: Equatable {
        let name: String
        let version: String
    }

    struct Found: Equatable {
        let id: String
        let name: String
        let installed: String
        let version: String
        var key: String { "\(id) \(version)" }
    }

    static let maxApps = 500

    static func watched(_ value: Any?) -> [Watched] {
        guard let list = value as? [Any] else { return [] }
        var out = [Watched]()
        for case let d as [String: Any] in list.prefix(maxApps) {
            guard let id = text(d["id"]), let version = text(d["version"]), let source = text(d["source"]),
                  let u = URL(string: source), ["http", "https"].contains(u.scheme?.lowercased() ?? "") else { continue }
            out.append(Watched(id: id, name: text(d["name"]) ?? id, version: version, source: source))
        }
        return out
    }

    private static func text(_ v: Any?) -> String? {
        guard let s = (v as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty, s.count <= 500 else { return nil }
        return s
    }

    // AltStore 2.x lists versions[] newest first; 1.x has one version on the app itself. A version string is
    // `version`, else `marketingVersion` (altstore.js parseVersion).
    static func offers(_ json: Data, ios: String?) -> [String: Offer] {
        guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let apps = root["apps"] as? [Any] else { return [:] }
        var out = [String: Offer]()
        for case let a as [String: Any] in apps {
            guard let id = text(a["bundleIdentifier"]) else { continue }
            var versions = (a["versions"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
            if versions.isEmpty { versions = [a] }
            for v in versions {
                guard let ver = text(v["version"]) ?? text(v["marketingVersion"]) else { continue }
                guard runs(min: text(v["minOSVersion"]), max: text(v["maxOSVersion"]), on: ios) else { continue }
                // The same id listed twice (variants, mirrors): the newest first-runnable version of them counts.
                if let have = out[id], DebVersion.compare(have.version, ver) >= 0 { break }
                out[id] = Offer(name: text(a["name"]) ?? id, version: ver)
                break
            }
        }
        return out
    }

    // altstore.js runsOn: maxOSVersion "16" means any 16.x, so the phone's version is cut to the bound's parts.
    static func runs(min: String?, max: String?, on ios: String?) -> Bool {
        guard let ios, !ios.isEmpty else { return true }
        if let min, compareOS(ios, min) < 0 { return false }
        if let max {
            let cut = ios.split(separator: ".").prefix(max.split(separator: ".").count).joined(separator: ".")
            if compareOS(cut, max) > 0 { return false }
        }
        return true
    }

    static func compareOS(_ a: String, _ b: String) -> Int {
        let pa = a.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) ?? 0 }
        let pb = b.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) ?? 0 }
        for i in 0..<Swift.max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
            if x != y { return x < y ? -1 : 1 }
        }
        return 0
    }

    // `offers`: per source URL, what offers(_:ios:) read from it (a source that failed to load is just absent).
    static func updates(_ watched: [Watched], offers: [String: [String: Offer]]) -> [Found] {
        var seen = Set<String>()
        var out = [Found]()
        for w in watched where !seen.contains(w.id) {
            guard let o = offers[w.source]?[w.id], DebVersion.compare(o.version, w.version) > 0 else { continue }
            seen.insert(w.id)
            out.append(Found(id: w.id, name: w.name, installed: w.version, version: o.version))
        }
        return out.sorted { ($0.name.lowercased(), $0.id) < ($1.name.lowercased(), $1.id) }
    }

    static func fresh(_ found: [Found], known: Set<String>) -> [Found] { found.filter { !known.contains($0.key) } }

    // The shell's known list after the page's updates.watch: what the page counts on screen now, plus what was known
    // before for apps still remembered at the same version (a source that failed on the page's last load doesn't
    // make an update notified once new again). An app installed since (a new remembered version) starts over.
    static func mergeKnown(old: Set<String>, oldWatch: [Watched], page: Set<String>, newWatch: [Watched]) -> Set<String> {
        let before = Dictionary(oldWatch.map { ($0.id, $0.version) }, uniquingKeysWith: { a, _ in a })
        let now = Dictionary(newWatch.map { ($0.id, $0.version) }, uniquingKeysWith: { a, _ in a })
        var out = page
        for k in old {
            guard let sp = k.firstIndex(of: " ") else { continue }
            let id = String(k[..<sp])
            if let v = now[id], before[id] == v { out.insert(k) }
        }
        return out
    }

    // B47: the icon badge a background run sets. It must equal Changes' rows, which this side can't fully see (re-signs,
    // the page's own rules), so it starts from what Changes counted when last open (`pageCount`, the page's app.badge)
    // and adds only the updates found for apps that count left out (`pageKeys`, the page's "<id> <version>" keys from
    // updates.watch): a newer version of a row already counted is the same row. The page follows only apps Changes
    // can count (no ignored app, none whose source is gone), so nothing Changes hides gets in.
    static func badge(_ found: [Found], pageCount: Int, pageKeys: Set<String>) -> Int {
        let counted = Set(pageKeys.compactMap { k in k.firstIndex(of: " ").map { String(k[..<$0]) } })
        return max(0, pageCount) + Set(found.map(\.id)).subtracting(counted).count
    }

    // B124: what the icon badge is made of (UpdateCheck.badge's parts, as BackgroundCheck stores them): Changes' last
    // count and keys, and the "<id> <version>" keys the last background run found (none once the page counts again).
    struct Counts: Equatable {
        var pageCount: Int
        var pageKeys: Set<String>
        var found: [String]
        var badge: Int {
            let counted = Set(pageKeys.compactMap(UpdateCheck.keyID))
            return max(0, pageCount) + Set(found.compactMap(UpdateCheck.keyID)).subtracting(counted).count
        }
    }

    static func keyID(_ k: String) -> String? { k.firstIndex(of: " ").map { String(k[..<$0]) } }

    // B124: iFizBox has handed iOS its own update (any of `ids`: its bundle ID, the source's ID): the icon stops counting
    // it at once, instead of keeping it until the new version's first launch (app.js lastVersion) or for ever when that
    // never comes. Changes' row for it (a page key with one of `ids`) comes off its count; a background find of it goes.
    // Every other update stays counted.
    static func without(_ ids: Set<String>, _ c: Counts) -> Counts {
        let mine = { (k: String) in keyID(k).map(ids.contains) ?? false }
        let row = c.pageKeys.contains(where: mine)
        return Counts(pageCount: max(0, c.pageCount - (row ? 1 : 0)), pageKeys: c.pageKeys.filter { !mine($0) },
                      found: c.found.filter { !mine($0) })
    }

    // B124: the watch list once iFizBox has handed iOS `version` of itself: its entries (any of `ids`) at that version,
    // so a background run before the new version's first launch doesn't find and badge the same update again. Never
    // lowers a version.
    static func handedOff(_ watch: [Watched], ids: Set<String>, version: String) -> [Watched] {
        watch.map { w in
            guard ids.contains(w.id), DebVersion.compare(version, w.version) > 0 else { return w }
            return Watched(id: w.id, name: w.name, version: version, source: w.source)
        }
    }

    // B158: the icon badge's setter, in order. Every count the page sends (app.badge) and the shell's own
    // (selfHandedOff, the background run) goes through one of these on the main thread: `want` as the count arrives,
    // `start` once iOS's permission is known, `done` when iOS has set it. Only the latest count is set, and only
    // one at a time: before, each app.badge waited on its own getNotificationSettings and set the badge from there,
    // so a 0 sent first (the first launch after an update, a recount before iFizBox's own row was read) could land
    // after the 1 that followed it and leave the icon bare while Changes showed 1.
    struct BadgeSync: Equatable {
        private(set) var wanted: Int?
        private(set) var busy = false
        mutating func want(_ n: Int) { wanted = max(0, n) }
        // The count to set now, or nil: nothing new, or one is being set (`done` hands the next).
        mutating func start() -> Int? {
            guard !busy, let w = wanted else { return nil }
            busy = true
            wanted = nil
            return w
        }
        mutating func done() -> Int? {
            busy = false
            return start()
        }
    }

    static func title(_ n: Int) -> String { n == 1 ? "1 Update" : "\(n) Updates" }

    static func body(_ found: [Found]) -> String {
        let names = found.map { "\($0.name) \($0.version)" }
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        case 2: return "\(names[0]) and \(names[1])"
        case 3: return "\(names[0]), \(names[1]) and \(names[2])"
        default: return "\(names[0]), \(names[1]) and \(names.count - 2) more"
        }
    }
}

// dpkg --compare-versions (Debian policy 5.6.12), lenient like web/app/core/apt.js: "[epoch:]upstream[-revision]".
enum DebVersion {
    static func compare(_ a: String, _ b: String) -> Int {
        let x = parse(a), y = parse(b)
        if x.epoch != y.epoch { return x.epoch < y.epoch ? -1 : 1 }
        let r = verrevcmp(x.upstream, y.upstream)
        let s = r != 0 ? r : verrevcmp(x.revision, y.revision)
        return s < 0 ? -1 : s > 0 ? 1 : 0
    }

    private static func parse(_ v: String) -> (epoch: Int, upstream: [UInt8], revision: [UInt8]) {
        var s = Substring(v.trimmingCharacters(in: .whitespacesAndNewlines))
        var epoch = 0
        if let colon = s.firstIndex(of: ":") {
            let e = s[..<colon]
            epoch = !e.isEmpty && e.allSatisfy({ $0.isASCII && $0.isNumber }) ? Int(e) ?? 0 : 0
            s = s[s.index(after: colon)...]
        }
        if let dash = s.lastIndex(of: "-") {
            return (epoch, Array(s[..<dash].utf8), Array(s[s.index(after: dash)...].utf8))
        }
        return (epoch, Array(s.utf8), [])
    }

    private static func digit(_ c: UInt8?) -> Bool { c.map { $0 >= 48 && $0 <= 57 } ?? false }

    // "~" before everything (even the end), then the end, then letters, then everything else.
    private static func order(_ c: UInt8?) -> Int {
        guard let c, !digit(c) else { return 0 }
        if c == UInt8(ascii: "~") { return -1 }
        if (c >= 65 && c <= 90) || (c >= 97 && c <= 122) { return Int(c) }
        return Int(c) + 256
    }

    private static func verrevcmp(_ a: [UInt8], _ b: [UInt8]) -> Int {
        var i = 0, j = 0
        func at(_ s: [UInt8], _ k: Int) -> UInt8? { k < s.count ? s[k] : nil }
        while i < a.count || j < b.count {
            while (i < a.count && !digit(a[i])) || (j < b.count && !digit(b[j])) {
                let ac = order(at(a, i)), bc = order(at(b, j))
                if ac != bc { return ac - bc }
                i += 1; j += 1
            }
            while at(a, i) == UInt8(ascii: "0") { i += 1 }
            while at(b, j) == UInt8(ascii: "0") { j += 1 }
            var first = 0
            while digit(at(a, i)) && digit(at(b, j)) {
                if first == 0 { first = Int(a[i]) - Int(b[j]) }
                i += 1; j += 1
            }
            if digit(at(a, i)) { return 1 }
            if digit(at(b, j)) { return -1 }
            if first != 0 { return first }
        }
        return 0
    }
}
