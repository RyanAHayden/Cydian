// Swift tests for N8's intents (native/intents/Core.swift), run on Linux by native/intents/test_intents.py against
// the fake helper (native/fake/ifizbox-helper) over a copy of native/fake/fixture/prefix:
//   intentstest <fake helper> <fixture prefix> <fake remote>
// Each intent gets a fresh copy of the prefix. Prints "ok   <name>" per test, "all passed" at the end, and the
// sideload restore's link as "LINK <url>" for the Python side to decode.
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

let args = CommandLine.arguments
guard args.count == 4 else { print("usage: intentstest <fake helper> <fixture prefix> <fake remote>"); exit(2) }
let helperPath = args[1], fixture = args[2], remote = args[3]
let fm = FileManager.default

// A host over the fake helper. `log` keeps every helper call's words, in order.
final class FakeHost: IntentHost {
    let jailbroken: Bool
    let prefix: String
    var env: [String: String] = [:]
    var log: [[String]] = []
    var sideload: [UpdateCheck.Found] = []

    init(jailbroken: Bool = true) throws {
        self.jailbroken = jailbroken
        let dir = NSTemporaryDirectory() + "intents-" + UUID().uuidString
        try fm.copyItem(atPath: fixture, toPath: dir)
        prefix = dir
    }

    deinit { try? fm.removeItem(atPath: prefix) }

    func helper(_ words: [String]) throws -> HelperResult {
        log.append(words)
        let status = prefix + "/.status-fd"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        // fd 3 is the status fd, as the real spawn gives it.
        p.arguments = ["-c", "exec \"$0\" \"$@\" 3>\"$STATUS_FILE\"", helperPath] + words
        var e = ProcessInfo.processInfo.environment
        e["IFIZBOX_PREFIX"] = prefix
        e["FAKE_REMOTE"] = remote
        e["STATUS_FILE"] = status
        for (k, v) in env { e[k] = v }
        p.environment = e
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        try p.run()
        let o = out.fileHandleForReading.readDataToEndOfFile()
        let r = err.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let st = (try? String(contentsOfFile: status, encoding: .utf8)) ?? ""
        return HelperResult(code: Int(p.terminationStatus), out: String(decoding: o, as: UTF8.self),
                            err: String(decoding: r, as: UTF8.self), status: st)
    }

    func read(_ path: String) -> String? { try? String(contentsOfFile: prefix + path, encoding: .utf8) }
    func list(_ dir: String) -> [String] { (try? fm.contentsOfDirectory(atPath: prefix + dir)) ?? [] }
    func sideloadUpdates() throws -> [UpdateCheck.Found] { sideload }

    func write(_ path: String, _ text: String) throws {
        try fm.createDirectory(atPath: (prefix + path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try text.write(toFile: prefix + path, atomically: true, encoding: .utf8)
    }
}

func throwsFailure(_ f: () throws -> Void) -> IntentFailure? {
    do { try f(); return nil } catch let e as IntentFailure { return e } catch { return IntentFailure("other: \(error)") }
}

// A gzip member for the sideload restore's link (the app's own is App/Host.swift's, over zlib).
func storedGzip(_ d: Data) -> Data {
    // gzip with one stored deflate block: fine for a test, and Python's gzip reads it.
    var out = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255])
    let n = UInt16(d.count)
    out.append(contentsOf: [1, UInt8(n & 0xff), UInt8(n >> 8), UInt8(~n & 0xff), UInt8(~n >> 8)])
    out.append(d)
    var crc: UInt32 = 0xffffffff
    for b in d { crc ^= UInt32(b); for _ in 0..<8 { crc = (crc >> 1) ^ (0xEDB88320 & (0 &- (crc & 1))) } }
    crc ^= 0xffffffff
    for v in [crc, UInt32(d.count)] { for i in 0..<4 { out.append(UInt8(truncatingIfNeeded: v >> (8 * UInt32(i)))) } }
    return out
}

test("check for updates: apt update, then installed vs the lists, held ones left out") {
    let h = try FakeHost()
    let r = try IntentsCore.checkForUpdates(h)
    check(h.log.first == ["update"], "\(h.log)")
    check(h.log.contains(["showhold"]), "\(h.log)")
    check(r.refreshed, "refreshed")
    check(r.updates.map(\.id) == ["apt", "com.example.tweak"], "\(r.updates)")
    check(r.count == 2 && r.title == "2 Updates", r.title)
    check(r.lines == ["apt 2.6.0 → 2.7.0", "Example Tweak 1.0 → 1.1"], "\(r.lines)")
    check(r.dialog == "2 Updates: apt 2.7.0 and Example Tweak 1.1.", r.dialog)
}

test("check for updates: a failed refresh still counts from the lists apt has") {
    let h = try FakeHost()
    h.env["FAKE_FAIL"] = "update"
    let r = try IntentsCore.checkForUpdates(h)
    check(!r.refreshed, "refreshed")
    check(r.count == 0, "\(r.updates)") // the fixture's lists dir starts empty
    check(r.dialog.hasPrefix("Everything is up to date. (couldn't refresh"), r.dialog)
}

test("check for updates: apt-mark holds and dpkg holds") {
    let h = try FakeHost()
    _ = try h.helper(["update"])
    _ = try h.helper(["hold", "com.example.tweak"])
    let r = try IntentsCore.checkForUpdates(h)
    check(r.updates.map(\.id) == ["apt"], "\(r.updates)")
}

test("check for updates: sideload asks the host (the remembered apps)") {
    let h = try FakeHost(jailbroken: false)
    h.sideload = [UpdateCheck.Found(id: "com.utm", name: "UTM", installed: "4.4", version: "4.5")]
    let r = try IntentsCore.checkForUpdates(h)
    check(h.log.isEmpty, "no helper in sideload: \(h.log)")
    check(r.title == "1 Update" && r.lines == ["UTM 4.4 → 4.5"], "\(r.lines)")
}

test("upgrades: newest of several lists, epochs, names from status") {
    let status = """
    Package: a
    Status: install ok installed
    Version: 1.0

    Package: b
    Status: install ok installed
    Version: 1:0.5
    Name: Bee

    Package: c
    Status: deinstall ok config-files
    Version: 0.1

    """
    let l1 = "Package: a\nVersion: 1.2\nName: Aye\n\nPackage: b\nVersion: 9.0\n\nPackage: c\nVersion: 2\n"
    let l2 = "Package: a\nVersion: 1.10\n\nPackage: b\nVersion: 1:0.6\n"
    let u = IntentsCore.upgrades(status: status, lists: [l1, l2], holds: [])
    check(u == [UpdateCheck.Found(id: "a", name: "a", installed: "1.0", version: "1.10"), // Name: of the newest stanza
                UpdateCheck.Found(id: "b", name: "Bee", installed: "1:0.5", version: "1:0.6")], "\(u)")
    check(IntentsCore.upgrades(status: status, lists: [l1], holds: ["a", "b"]).isEmpty, "holds")
}

test("install all updates: apply of every upgrade, finish: from the status fd") {
    let h = try FakeHost()
    h.env["FAKE_FINISH"] = "restart"
    let r = try IntentsCore.installAllUpdates(h)
    check(h.log.last == ["apply", "apt", "com.example.tweak"], "\(h.log)")
    check(r.installed.count == 2 && r.finish == "restart", "\(r)")
    check(r.dialog == "Installed 2 updates. Respring to finish.", r.dialog)
    // dpkg's status now has the new versions: nothing left.
    check(try IntentsCore.pending(h).isEmpty, "left over")
}

test("install all updates: nothing to do, apt's error, sideload") {
    let h = try FakeHost()
    _ = try IntentsCore.installAllUpdates(h)
    let calls = h.log.count
    let again = try IntentsCore.installAllUpdates(h)
    check(again.installed.isEmpty && again.dialog == "Everything is up to date.", again.dialog)
    check(!h.log.dropFirst(calls).contains { $0.first == "apply" }, "\(h.log)")
    let f = try FakeHost()
    f.env["FAKE_FAIL"] = "apply"
    check(throwsFailure { _ = try IntentsCore.installAllUpdates(f) }?.message == "Installing failed: E: Sub-process /usr/bin/dpkg returned an error code (1)", "apply failure")
    let s = try FakeHost(jailbroken: false)
    check(throwsFailure { _ = try IntentsCore.installAllUpdates(s) } == .needsJailbreak, "sideload")
}

test("finish: the strongest wins") {
    check(IntentsCore.finish("pmstatus:x:1:y\nfinish:reopen\nfinish:restart\n") == "restart", "restart")
    check(IntentsCore.finish("finish:reboot\nfinish:restart\n") == "reboot", "reboot")
    check(IntentsCore.finish("finish:bogus\n") == nil, "bogus")
    check(InstallReport(installed: [UpdateCheck.Found(id: "a", name: "A", installed: "1", version: "2")], finish: "reboot").dialog
          == "Installed 1 update. Reboot to finish.", "reboot dialog")
}

test("respring and userspace reboot: the helper's verbs, jailbreak only") {
    let h = try FakeHost()
    try IntentsCore.respring(h)
    try IntentsCore.userspaceReboot(h)
    check(h.log == [["respring"], ["userspace-reboot"]], "\(h.log)")
    let s = try FakeHost(jailbroken: false)
    check(throwsFailure { try IntentsCore.respring(s) } == .needsJailbreak, "respring sideload")
    check(throwsFailure { try IntentsCore.userspaceReboot(s) } == .needsJailbreak, "reboot sideload")
    check(s.log.isEmpty, "\(s.log)")
}

test("add source: a ifizbox://add link for the page's alert") {
    let u = try IntentsCore.addSourceLink(URL(string: "https://repo.example.com/")!)
    check(u.absoluteString == "ifizbox://add?url=https://repo.example.com/", u.absoluteString)
    let d = try IntentsCore.addSourceLink(URL(string: "https://apt.procurs.us/")!, suite: "1800", components: ["main"])
    check(d.absoluteString == "ifizbox://add?url=https://apt.procurs.us/&suite=1800&component=main", d.absoluteString)
    let q = try IntentsCore.addSourceLink(URL(string: "https://r.example/a?b=c&d=e+f")!)
    check(q.absoluteString == "ifizbox://add?url=https://r.example/a?b%3Dc%26d%3De%2Bf", q.absoluteString)
    check(throwsFailure { _ = try IntentsCore.addSourceLink(URL(string: "ftp://x.example/")!) } != nil, "ftp")
    check(throwsFailure { _ = try IntentsCore.addSourceLink(URL(string: "file:///etc/passwd")!) } != nil, "file")
}

test("export my packages: sources, manual packages, holds") {
    let h = try FakeHost()
    try h.write("/var/lib/apt/extended_states", "Package: apt\nArchitecture: iphoneos-arm64\nAuto-Installed: 1\n\n")
    try h.write("/etc/apt/sources.list", "deb [signed-by=/x.gpg] https://one.example/ stable main extra # comment\n# deb https://off.example/ ./\n")
    let data = try IntentsCore.exportBackup(h, now: Date(timeIntervalSince1970: 1_800_000_000))
    let b = try IntentsCore.parseBackup(data)
    check(b.created == "2027-01-15T08:00:00Z", b.created)
    check(b.packages.map(\.id) == ["com.example.held", "com.example.tweak"], "\(b.packages)")
    check(b.packages.last?.name == "Example Tweak" && b.packages.last?.version == "1.0", "\(b.packages)")
    check(b.holds == ["com.example.held"], "\(b.holds)")
    check(b.sources == [BackupSource(uri: "https://one.example/", suite: "stable", components: ["main", "extra"]),
                        BackupSource(uri: "https://havoc.app/", suite: "./", components: []),
                        BackupSource(uri: "https://apt.procurs.us/", suite: "1800", components: ["main"])], "\(b.sources)")
    check(String(decoding: data, as: UTF8.self).contains("\"format\" : \"ifizbox-backup\""), "format")
    check(IntentsCore.backupFileName(Date(timeIntervalSince1970: 1_800_000_000)) == "\(Brand.name) Packages 2027-01-15.json", "name")
    check(throwsFailure { _ = try IntentsCore.exportBackup(FakeHost(jailbroken: false)) } == .needsJailbreak, "sideload")
}

test("restore my packages: new sources, apt update, installs, holds") {
    let h = try FakeHost()
    let b = Backup(created: "2026-11-17T00:00:00Z",
                   sources: [BackupSource(uri: "https://havoc.app/", suite: "./", components: []),
                             BackupSource(uri: "https://new.example", suite: "./", components: []),
                             BackupSource(uri: "https://bad example/", suite: "./", components: [])],
                   packages: [BackupPackage(id: "com.example.tweak", version: "1.0", name: nil),
                              BackupPackage(id: "bash", version: "5.1", name: nil),
                              BackupPackage(id: "com.example.rootful", version: "1.0", name: nil),
                              BackupPackage(id: "com.example.nowhere", version: "1.0", name: nil)],
                   holds: ["bash", "com.example.nowhere"])
    let r = try IntentsCore.restore(try JSONEncoder().encode(b), h, gzip: storedGzip)
    check(r.addedSources == [b.sources[1]], "\(r.addedSources)")
    check(r.failedSources.count == 1 && r.failedSources[0].hasPrefix("https://bad example/ ./: ifizbox-helper: bad URI"), "\(r.failedSources)")
    check(h.log.contains(["addsource", "https://new.example/", "./"]), "\(h.log)")
    check(h.log.contains(["apply", "bash", "com.example.rootful"]), "\(h.log)")
    check(r.installed == ["bash", "com.example.rootful"] && r.alreadyInstalled == 1, "\(r)")
    check(r.missing == ["com.example.nowhere"], "\(r.missing)")
    check(r.held == ["bash"] && h.log.last == ["hold", "bash"], "\(r.held) \(h.log)")
    check(h.read("/etc/apt/sources.list.d/ifizbox.sources")?.contains("URIs: https://new.example/") == true, "ifizbox.sources")
    check(r.dialog.hasPrefix("Added 1 source, installed 2 packages, 1 already installed. Not in any source: com.example.nowhere."), r.dialog)
    check(try IntentsCore.pending(h).map(\.id) == ["apt", "com.example.tweak"], "after restore")
}

test("restore my packages: refused files") {
    let h = try FakeHost()
    check(throwsFailure { _ = try IntentsCore.restore(Data("{}".utf8), h, gzip: storedGzip) }?.message == "That isn't a file from Export My Packages.", "empty")
    var b = Backup(created: "x", sources: [], packages: [], holds: [])
    b.version = 2
    check(throwsFailure { _ = try IntentsCore.restore(try JSONEncoder().encode(b), h, gzip: storedGzip) }?.message.contains("newer \(Brand.name)") == true, "v2")
    check(throwsFailure { _ = try IntentsCore.restore(Data(count: IntentsCore.maxBackup + 1), h, gzip: storedGzip) }?.message.contains("too big") == true, "big")
    check(h.log.isEmpty, "\(h.log)")
}

test("restore my packages: sideload restores sources only, as an import link") {
    let h = try FakeHost(jailbroken: false)
    let b = Backup(created: "x", sources: [BackupSource(uri: "https://apt.procurs.us/", suite: "1800", components: ["main"]),
                                          BackupSource(uri: "https://havoc.app/", suite: "./", components: [])],
                   packages: [BackupPackage(id: "bash", version: "5", name: nil)], holds: ["bash"])
    let r = try IntentsCore.restore(try JSONEncoder().encode(b), h, gzip: storedGzip)
    check(h.log.isEmpty, "\(h.log)")
    check(r.importLink?.hasPrefix("ifizbox://import?d=") == true, "\(String(describing: r.importLink))")
    check(r.dialog == "Opening \(Brand.name) to add the sources.", r.dialog)
    print("LINK \(r.importLink ?? "")")
    let empty = Backup(created: "x", sources: [], packages: [], holds: [])
    check(throwsFailure { _ = try IntentsCore.restore(try JSONEncoder().encode(empty), h, gzip: storedGzip) } != nil, "no sources")
}

test("widget share: app snapshot, daemon state, the newer wins") {
    let s = WidgetShare.Snapshot(count: 3, names: ["a", "b", "c"], checked: Date(timeIntervalSince1970: 100))
    check(WidgetShare.decode(WidgetShare.encode(s)) == s, "round trip")
    check(WidgetShare.decode(["count": "x"]) == nil, "bad")
    let d = WidgetShare.daemonState("last 200\napt=2.7.0\ncom.example.tweak=1.1\n")
    check(d == WidgetShare.Snapshot(count: 2, names: ["apt", "com.example.tweak"], checked: Date(timeIntervalSince1970: 200)), "\(String(describing: d))")
    check(WidgetShare.daemonState("apt=1\n") == nil, "no last")
    check(WidgetShare.pick(s, d) == d && WidgetShare.pick(s, nil) == s && WidgetShare.pick(nil, nil) == nil, "pick")
    check(WidgetShare.label(nil) == "Open \(Brand.name)" && WidgetShare.label(d) == "2 Updates", "label")
    check(WidgetShare.label(WidgetShare.Snapshot(count: 0, names: [], checked: Date())) == "Up to Date", "zero")
}

print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
