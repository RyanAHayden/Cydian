// N8: what iFizBox's App Intents do, without AppIntents or UIKit, so it builds and is tested on Linux against the fake
// helper (native/intents/test_intents.py). The intents themselves (App/Intents.swift) and the widget's controls
// (native/widget/) only turn their parameters into one of these calls and its result into a dialog and a value.
//
//   IntentsCore.checkForUpdates(host)       -> UpdatesReport  jailbreak: apt update, then installed vs the lists;
//                                                              sideload: the apps Install remembered (host.sideloadUpdates)
//   IntentsCore.installAllUpdates(host)     -> InstallReport  jailbreak: the check, then `apply` of every upgrade
//   IntentsCore.respring / userspaceReboot  jailbreak: the helper's verbs
//   IntentsCore.addSourceLink(url)          -> ifizbox://add?url=… for the page's Add Source alert (both modes)
//   IntentsCore.exportBackup(host)          -> Data  jailbreak: sources, manually installed packages and holds (JSON)
//   IntentsCore.restore(data, host)         -> RestoreReport  jailbreak: sources, apt update, installs, holds;
//                                              sideload: its sources as a ifizbox://import link (Import's review alert)
// Upgrades are what web/app/core's Changes would list: an installed package (dpkg status "install ok installed")
// whose newest version in apt's lists is newer (DebVersion, native/sign/Updates.swift), held ones left out.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct HelperResult {
    let code: Int
    let out: String
    let err: String
    let status: String // fd 3: apt's status lines and maintainer scripts' finish: lines
}

// What the intents need from the phone. The app's (App/Host.swift) spawns the real ifizbox-helper as root; the tests'
// runs native/fake/ifizbox-helper over a fixture prefix.
protocol IntentHost {
    var jailbroken: Bool { get }
    var prefix: String { get }                      // the jailbreak's root ("/var/jb", roothide's jbroot, "" rootful)
    func helper(_ words: [String]) throws -> HelperResult
    func read(_ path: String) -> String?            // a file under the prefix, or nil
    func list(_ dir: String) -> [String]            // file names in a directory under the prefix
    func sideloadUpdates() throws -> [UpdateCheck.Found]
}

struct IntentFailure: Error, CustomStringConvertible, Equatable {
    let message: String
    init(_ m: String) { message = m }
    var description: String { message }
    static let needsJailbreak = IntentFailure("This needs \(Brand.name)'s jailbreak build: in the sideload app there is no root helper.")
}

struct UpdatesReport: Equatable {
    var updates: [UpdateCheck.Found]
    var refreshed = true // false: apt-get update failed, counted from the lists apt already had
    var count: Int { updates.count }
    var title: String { updates.isEmpty ? "No Updates" : UpdateCheck.title(count) }
    // One line per update, the Shortcuts value: "Name installed → new".
    var lines: [String] { updates.map { "\($0.name) \($0.installed) → \($0.version)" } }
    var dialog: String {
        let note = refreshed ? "" : " (couldn't refresh sources; counted from the last refresh)"
        return updates.isEmpty ? "Everything is up to date.\(note)" : "\(title): \(UpdateCheck.body(updates)).\(note)"
    }
}

struct InstallReport: Equatable {
    var installed: [UpdateCheck.Found]
    var finish: String? // "restart"/"reload" (respring), "reboot": what a maintainer script asked for
    var dialog: String {
        if installed.isEmpty { return "Everything is up to date." }
        let what = installed.count == 1 ? "Installed 1 update" : "Installed \(installed.count) updates"
        switch finish {
        case "reboot": return "\(what). Reboot to finish."
        case "restart", "reload", "reopen": return "\(what). Respring to finish."
        default: return "\(what)."
        }
    }
}

// A source as apt has it: one URI, one suite ("./" for a flat repo), components only when the suite isn't flat.
struct BackupSource: Codable, Hashable {
    let uri: String
    let suite: String
    let components: [String]

    var key: String { BackupSource.normal(uri) + " " + suite }
    static func normal(_ uri: String) -> String { uri.hasSuffix("/") ? uri : uri + "/" }
    // How iFizBox's Import (web/app/core/sourcelist.js exportLine) writes one: a flat repo's URL, else a deb line.
    var exportLine: String { suite.hasSuffix("/") ? uri : (["deb", uri, suite] + components).joined(separator: " ") }
}

struct BackupPackage: Codable, Hashable {
    let id: String
    let version: String
    let name: String?
}

// The Export My Packages file. `format` and `version` say what it is; a newer version is refused, not misread.
struct Backup: Codable, Equatable {
    static let formatName = "ifizbox-backup"
    var format = Backup.formatName
    var version = 1
    var created: String
    var sources: [BackupSource]
    var packages: [BackupPackage]
    var holds: [String]
}

struct RestoreReport: Equatable {
    var addedSources: [BackupSource] = []
    var failedSources: [String] = []         // "uri suite: why"
    var installed: [String] = []             // package ids
    var alreadyInstalled = 0
    var missing: [String] = []               // ids in no source's list
    var held: [String] = []
    var importLink: String?                  // sideload: hand the sources to the page
    var installError: String?
    var refreshed = true

    var dialog: String {
        if let _ = importLink { return "Opening \(Brand.name) to add the sources." }
        var parts = [String]()
        parts.append(addedSources.count == 1 ? "Added 1 source" : "Added \(addedSources.count) sources")
        if let e = installError { parts.append("installing failed: \(e)") } else {
            parts.append(installed.count == 1 ? "installed 1 package" : "installed \(installed.count) packages")
        }
        if alreadyInstalled > 0 { parts.append("\(alreadyInstalled) already installed") }
        var text = parts.joined(separator: ", ") + "."
        if !missing.isEmpty { text += " Not in any source: \(missing.joined(separator: ", "))." }
        if !failedSources.isEmpty { text += " Couldn't add: \(failedSources.joined(separator: "; "))." }
        if !refreshed { text += " Refreshing sources failed." }
        return text
    }
}

enum IntentsCore {
    static let maxBackup = 4 << 20

    // ---- Check for Updates

    static func checkForUpdates(_ host: IntentHost) throws -> UpdatesReport {
        guard host.jailbroken else { return UpdatesReport(updates: try host.sideloadUpdates()) }
        let refresh = try host.helper(["update"])
        var r = UpdatesReport(updates: try pending(host))
        r.refreshed = refresh.code == 0
        return r
    }

    // The upgrades from what's on disk now (no apt update).
    static func pending(_ host: IntentHost) throws -> [UpdateCheck.Found] {
        guard let status = host.read("/var/lib/dpkg/status") else { throw IntentFailure("Can't read dpkg's status file.") }
        let held = try holds(host)
        let lists = listFiles(host).compactMap { host.read("/var/lib/apt/lists/" + $0) }
        return upgrades(status: status, lists: lists, holds: held)
    }

    static func listFiles(_ host: IntentHost) -> [String] {
        host.list("/var/lib/apt/lists").filter { $0.hasSuffix("_Packages") }.sorted()
    }

    static func holds(_ host: IntentHost) throws -> Set<String> {
        let r = try host.helper(["showhold"])
        guard r.code == 0 else { return [] }
        return Set(r.out.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            .map { $0.split(separator: ":").first.map(String.init) ?? $0 })
    }

    struct Installed { let version: String; let name: String?; let held: Bool }

    // dpkg's status: the installed packages (Status "<want> ok installed"); "hold ok installed" is dpkg's own hold.
    static func installed(_ status: String) -> [String: Installed] {
        var out = [String: Installed]()
        stanzas(status) { f in
            guard let id = f["package"], let v = f["version"], let st = f["status"] else { return }
            let words = st.split(separator: " ")
            guard words.count == 3, words[2] == "installed" else { return }
            out[id] = Installed(version: v, name: f["name"], held: words[0] == "hold")
        }
        return out
    }

    // The newest version of each package `wanted` in apt's Packages files, with its Name:.
    static func newest(_ lists: [String], wanted: (String) -> Bool) -> [String: (version: String, name: String?)] {
        var out = [String: (version: String, name: String?)]()
        for text in lists {
            stanzas(text) { f in
                guard let id = f["package"], wanted(id), let v = f["version"] else { return }
                if let have = out[id], DebVersion.compare(v, have.version) <= 0 { return }
                out[id] = (v, f["name"])
            }
        }
        return out
    }

    static func upgrades(status: String, lists: [String], holds: Set<String>) -> [UpdateCheck.Found] {
        let have = installed(status)
        let best = newest(lists) { have[$0] != nil }
        var out = [UpdateCheck.Found]()
        for (id, i) in have where !i.held && !holds.contains(id) {
            guard let b = best[id], DebVersion.compare(b.version, i.version) > 0 else { continue }
            out.append(UpdateCheck.Found(id: id, name: i.name ?? b.name ?? id, installed: i.version, version: b.version))
        }
        return out.sorted { ($0.name.lowercased(), $0.id) < ($1.name.lowercased(), $1.id) }
    }

    // Debian control stanzas, the fields wanted lower-cased; continuation lines are skipped (none of ours spans).
    static func stanzas(_ text: String, _ each: ([String: String]) -> Void) {
        let keys: Set<Substring> = ["package", "version", "status", "name", "auto-installed", "essential"]
        var f = [String: String]()
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.isEmpty || line == "\r" {
                if !f.isEmpty { each(f); f.removeAll(keepingCapacity: true) }
                continue
            }
            guard let first = line.first, first != " ", first != "\t", let colon = line.firstIndex(of: ":") else { continue }
            let k = line[..<colon].lowercased()
            guard keys.contains(Substring(k)) else { continue }
            f[k] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !f.isEmpty { each(f) }
    }

    // ---- Install All Updates

    static func installAllUpdates(_ host: IntentHost) throws -> InstallReport {
        guard host.jailbroken else { throw IntentFailure.needsJailbreak }
        let found = try checkForUpdates(host).updates
        guard !found.isEmpty else { return InstallReport(installed: [], finish: nil) }
        // apply (apt-get install of each by name: the newest, pulling new dependencies in) rather than `upgrade`,
        // which leaves any upgrade that needs a new package behind. The helper takes at most 256 items.
        let r = try host.helper(["apply"] + found.prefix(256).map(\.id))
        guard r.code == 0 else { throw IntentFailure("Installing failed: \(lastError(r))") }
        return InstallReport(installed: Array(found.prefix(256)), finish: finish(r.status))
    }

    // The strongest finish: a maintainer script asked for (Cydia's protocol): reboot > restart/reload > reopen.
    static func finish(_ status: String) -> String? {
        let rank = ["reopen": 1, "restart": 2, "reload": 2, "reboot": 3]
        var best: String?
        for line in status.split(separator: "\n") where line.hasPrefix("finish:") {
            let w = String(line.dropFirst(7)).trimmingCharacters(in: .whitespaces)
            if let r = rank[w], r > (best.flatMap { rank[$0] } ?? 0) { best = w }
        }
        return best
    }

    static func lastError(_ r: HelperResult) -> String {
        let lines = r.err.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
        return lines.last(where: { $0.hasPrefix("E:") }) ?? lines.last ?? "exit \(r.code)"
    }

    // ---- Respring, Userspace Reboot

    static func respring(_ host: IntentHost) throws {
        guard host.jailbroken else { throw IntentFailure.needsJailbreak }
        let r = try host.helper(["respring"])
        guard r.code == 0 else { throw IntentFailure("Respring failed: \(lastError(r))") }
    }

    static func userspaceReboot(_ host: IntentHost) throws {
        guard host.jailbroken else { throw IntentFailure.needsJailbreak }
        let r = try host.helper(["userspace-reboot"])
        guard r.code == 0 else { throw IntentFailure("Userspace reboot failed: \(lastError(r))") }
    }

    // ---- Add Source

    // ifizbox://add?url=… (and suite/component for a dist repo, core/handoff.js parseAddLink): the page opens its
    // Add Source alert filled in, so the user still sees the URL, iFizBox's source warnings and Verifying URL.
    static func addSourceLink(_ url: URL, suite: String? = nil, components: [String] = []) throws -> URL {
        let s = url.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", let host = url.host, !host.isEmpty
        else { throw IntentFailure("A source is an http:// or https:// URL.") }
        var c = URLComponents()
        c.scheme = "ifizbox"
        c.host = "add"
        var q = [URLQueryItem(name: "url", value: s)]
        if let suite, !suite.isEmpty, !suite.hasSuffix("/") {
            q.append(URLQueryItem(name: "suite", value: suite))
            q += components.map { URLQueryItem(name: "component", value: $0) }
        }
        c.queryItems = q
        // URLComponents leaves & = + in a value alone; the page's URLSearchParams would split on them.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let out = c.url else { throw IntentFailure("That URL can't be passed on.") }
        return out
    }

    // ---- Export My Packages

    static func exportBackup(_ host: IntentHost, now: Date = Date()) throws -> Data {
        guard host.jailbroken else { throw IntentFailure.needsJailbreak }
        guard let status = host.read("/var/lib/dpkg/status") else { throw IntentFailure("Can't read dpkg's status file.") }
        let auto = autoInstalled(host.read("/var/lib/apt/extended_states") ?? "")
        let pkgs = installed(status).filter { !auto.contains($0.key) }
            .map { BackupPackage(id: $0.key, version: $0.value.version, name: $0.value.name) }
            .sorted { $0.id < $1.id }
        var held = try holds(host)
        for (id, i) in installed(status) where i.held { held.insert(id) }
        let b = Backup(created: iso(now), sources: sources(host), packages: pkgs, holds: held.sorted())
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try enc.encode(b)
    }

    static func iso(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return f.string(from: d)
    }

    static func backupFileName(_ now: Date = Date()) -> String { "\(Brand.name) Packages \(iso(now).prefix(10)).json" }

    // apt's extended_states: the packages apt installed as dependencies (Auto-Installed: 1). They come back by
    // themselves when what needs them is restored, so the file lists only what the user chose.
    static func autoInstalled(_ text: String) -> Set<String> {
        var out = Set<String>()
        stanzas(text) { f in if let id = f["package"], f["auto-installed"] == "1" { out.insert(id) } }
        return out
    }

    // Every apt source on the phone: sources.list, sources.list.d/*.list (one-line) and *.sources (deb822), each once.
    static func sources(_ host: IntentHost) -> [BackupSource] {
        var texts = [(String, Bool)]()
        if let t = host.read("/etc/apt/sources.list") { texts.append((t, false)) }
        for n in host.list("/etc/apt/sources.list.d").sorted() {
            guard n.hasSuffix(".list") || n.hasSuffix(".sources"), let t = host.read("/etc/apt/sources.list.d/" + n) else { continue }
            texts.append((t, n.hasSuffix(".sources")))
        }
        var seen = Set<String>()
        var out = [BackupSource]()
        for (t, deb822) in texts {
            for s in deb822 ? parseDeb822(t) : parseOneLine(t) where seen.insert(s.key).inserted { out.append(s) }
        }
        return out
    }

    static func parseOneLine(_ text: String) -> [BackupSource] {
        var out = [BackupSource]()
        text.enumerateLines { raw, _ in
            let line = raw.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            var w = line.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            guard w.first == "deb" else { return }
            w.removeFirst()
            if w.first?.hasPrefix("[") == true { // [arch=… signed-by=…]
                while let x = w.first { w.removeFirst(); if x.hasSuffix("]") { break } }
            }
            guard w.count >= 2 else { return }
            out.append(BackupSource(uri: w[0], suite: w[1], components: w[1].hasSuffix("/") ? [] : Array(w.dropFirst(2))))
        }
        return out
    }

    static func parseDeb822(_ text: String) -> [BackupSource] {
        var out = [BackupSource]()
        var f = [String: String]()
        func flush() {
            defer { f.removeAll() }
            if let t = f["types"], !t.split(separator: " ").contains("deb") { return }
            if f["enabled"]?.lowercased() == "no" { return }
            let uris = (f["uris"] ?? "").split(separator: " ").map(String.init)
            let suites = (f["suites"] ?? "").split(separator: " ").map(String.init)
            let comps = (f["components"] ?? "").split(separator: " ").map(String.init)
            for u in uris { for s in suites { out.append(BackupSource(uri: u, suite: s, components: s.hasSuffix("/") ? [] : comps)) } }
        }
        text.enumerateLines { line, _ in
            if line.trimmingCharacters(in: .whitespaces).isEmpty { flush(); return }
            if line.hasPrefix("#") { return }
            if line.first == " " || line.first == "\t" { return }
            guard let colon = line.firstIndex(of: ":") else { return }
            f[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        flush()
        return out
    }

    // ---- Restore My Packages

    static func parseBackup(_ data: Data) throws -> Backup {
        guard data.count <= maxBackup else { throw IntentFailure("That file is too big to be a \(Brand.name) backup.") }
        guard let b = try? JSONDecoder().decode(Backup.self, from: data), b.format == Backup.formatName else {
            throw IntentFailure("That isn't a file from Export My Packages.")
        }
        guard b.version == 1 else { throw IntentFailure("That backup is from a newer \(Brand.name); update \(Brand.name) first.") }
        return b
    }

    // The import link the sideload app reads (web/app/core/transfer.js decodeLink): { v: 1, sources, holds }.
    static func importPayload(_ b: Backup) throws -> Data {
        let o: [String: Any] = ["v": 1, "sources": b.sources.map(\.exportLine), "settings": [String: Any](), "holds": [String]()]
        return try JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func restore(_ data: Data, _ host: IntentHost, gzip: (Data) throws -> Data) throws -> RestoreReport {
        let b = try parseBackup(data)
        var r = RestoreReport()
        guard host.jailbroken else {
            guard !b.sources.isEmpty else { throw IntentFailure("That backup has no sources.") }
            r.importLink = "ifizbox://import?d=" + base64url(try gzip(try importPayload(b)))
            return r
        }
        // 1. the sources this phone doesn't have yet, into iFizBox's own file (ifizbox-helper addsource)
        let have = Set(sources(host).map(\.key))
        for s in b.sources where !have.contains(s.key) {
            let res = try host.helper(["addsource", BackupSource.normal(s.uri), s.suite] + s.components)
            if res.code == 0 { r.addedSources.append(s) } else { r.failedSources.append("\(s.uri) \(s.suite): \(lastError(res))") }
        }
        // 2. refresh, 3. install what isn't installed and some list has (the newest: after a re-jailbreak or on a
        // new phone the old versions are often gone), 4. holds
        r.refreshed = try host.helper(["update"]).code == 0
        guard let status = host.read("/var/lib/dpkg/status") else { throw IntentFailure("Can't read dpkg's status file.") }
        let inst = installed(status)
        let wanted = Set(b.packages.map(\.id).filter { inst[$0] == nil })
        r.alreadyInstalled = b.packages.count - wanted.count
        let lists = listFiles(host).compactMap { host.read("/var/lib/apt/lists/" + $0) }
        let known = newest(lists) { wanted.contains($0) }
        let todo = b.packages.map(\.id).filter { wanted.contains($0) && known[$0] != nil }
        r.missing = b.packages.map(\.id).filter { wanted.contains($0) && known[$0] == nil }
        var start = 0
        while start < todo.count && r.installError == nil { // the helper takes 256 items a run
            let batch = Array(todo[start..<min(start + 256, todo.count)])
            let res = try host.helper(["apply"] + batch)
            if res.code == 0 { r.installed += batch } else { r.installError = lastError(res) }
            start += 256
        }
        let nowInstalled = Set(inst.keys).union(r.installed)
        let toHold = b.holds.filter { nowInstalled.contains($0) }
        if !toHold.isEmpty, try host.helper(["hold"] + toHold).code == 0 { r.held = toHold }
        return r
    }

    static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// ---- What the app shares with the widget (App Group defaults; the widget reads, the app writes)

enum WidgetShare {
    static let group = "group.com.ryha.ifizbox"
    static let key = "ifizbox.widget.updates" // {count: Int, names: [String], checked: Double (seconds since 1970)}
    static let kind = "iFizBoxUpdates"        // the widget's kind, for reloads

    struct Snapshot: Equatable {
        var count: Int
        var names: [String]
        var checked: Date
    }

    static func encode(_ s: Snapshot) -> [String: Any] {
        ["count": s.count, "names": Array(s.names.prefix(8)), "checked": s.checked.timeIntervalSince1970]
    }

    static func decode(_ v: Any?) -> Snapshot? {
        guard let d = v as? [String: Any], let n = (d["count"] as? NSNumber)?.intValue,
              let t = (d["checked"] as? NSNumber)?.doubleValue else { return nil }
        return Snapshot(count: max(0, n), names: (d["names"] as? [String]) ?? [], checked: Date(timeIntervalSince1970: t))
    }

    // N5's daemon's state file (native/daemon/upgrades.h upd_state): "last <time>", then one "<id>=<to>" per upgrade.
    static func daemonState(_ text: String) -> Snapshot? {
        var last: Double?
        var names = [String]()
        for line in text.split(separator: "\n") {
            if line.hasPrefix("last ") { last = Double(line.dropFirst(5).trimmingCharacters(in: .whitespaces)) }
            else if let eq = line.firstIndex(of: "="), eq != line.startIndex { names.append(String(line[..<eq])) }
        }
        guard let last, last > 0 else { return nil }
        return Snapshot(count: names.count, names: names, checked: Date(timeIntervalSince1970: last))
    }

    // The newer of the two.
    static func pick(_ a: Snapshot?, _ b: Snapshot?) -> Snapshot? {
        guard let a else { return b }
        guard let b else { return a }
        return a.checked >= b.checked ? a : b
    }

    static func label(_ s: Snapshot?) -> String {
        guard let s else { return "Open \(Brand.name)" }
        return s.count == 0 ? "Up to Date" : UpdateCheck.title(s.count)
    }
}
