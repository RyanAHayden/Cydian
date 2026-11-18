// Swift unit tests for the on-device signer (I6), run on Linux by native/test_sign.py: signs a fixture IPA with a
// throwaway certificate (key held by openssl here, by the Keychain on the phone) and checks the signature verifies,
// plus the pieces under it (hashes, DER entitlements, zip, profile rules, the local install CA).
//   signtest <fixtures dir> <work dir>
// Fixtures come from native/test_sign.py (native/testkit.py's throwaway CA, certificate and profiles).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: signtest <fixtures> <work>"); exit(2) }
let fixtures = URL(fileURLWithPath: args[1])
let work = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

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
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
func fixture(_ name: String) throws -> Data { try Data(contentsOf: fixtures.appendingPathComponent(name)) }

@discardableResult
func run(_ argv: [String], input: Data? = nil) throws -> (Int32, Data, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = argv
    let out = Pipe(), err = Pipe(), inp = Pipe()
    p.standardOutput = out; p.standardError = err; p.standardInput = inp
    try p.run()
    if let input = input { inp.fileHandleForWriting.write(input) }
    inp.fileHandleForWriting.closeFile()
    let o = out.fileHandleForReading.readDataToEndOfFile()
    let e = err.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return (p.terminationStatus, o, String(decoding: e, as: UTF8.self))
}

// The phone's Keychain identity, played by openssl: the private key stays in its PEM file.
struct OpenSSLIdentity: SigningIdentity {
    let keyPath: String
    let certificate: Data
    let chain: [Data]
    var signatureAlgorithm: String { "1.2.840.113549.1.1.1" }
    func sign(_ message: Data) throws -> Data {
        let (rc, sig, err) = try run(["openssl", "dgst", "-sha256", "-sign", keyPath], input: message)
        guard rc == 0 else { throw SignError("openssl", err) }
        return sig
    }
}

// ---- reading a signature back (independently of how CodeSign.swift wrote it, as far as the format allows)

struct ReadSignature {
    var cd = Data(), cms = Data(), ents = Data(), entsDER = Data(), reqs = Data()
    var identifier = "", team = "", codeLimit = 0, nSpecial = 0, nCode = 0, hashOff = 0, execFlags: UInt64 = 0
    func special(_ slot: Int) -> Data { cd.subdata(in: hashOff - slot * 32..<hashOff - slot * 32 + 32) }
}

func readSignature(_ bin: Data) -> ReadSignature? {
    guard bin.le32(at: 0) == MachO.magic64 else { return nil }
    var off = 32
    var sig: (Int, Int)? = nil
    for _ in 0..<Int(bin.le32(at: 16)) {
        if bin.le32(at: off) == 0x1D { sig = (Int(bin.le32(at: off + 8)), Int(bin.le32(at: off + 12))) }
        off += Int(bin.le32(at: off + 4))
    }
    guard let (so, ss) = sig, so + ss <= bin.count else { return nil }
    let sb = bin.subdata(in: so..<so + ss)
    guard sb.be32(at: 0) == 0xFADE0CC0 else { return nil }
    var r = ReadSignature()
    for i in 0..<Int(sb.be32(at: 8)) {
        let t = sb.be32(at: 12 + 8 * i), o = Int(sb.be32(at: 16 + 8 * i))
        let len = Int(sb.be32(at: o + 4))
        let b = sb.subdata(in: o..<o + len)
        switch t {
        case 0: r.cd = b
        case 2: r.reqs = b
        case 5: r.ents = b
        case 7: r.entsDER = b
        case 0x10000: r.cms = b.subdata(in: 8..<b.count)
        default: break
        }
    }
    let cd = r.cd
    r.hashOff = Int(cd.be32(at: 16))
    let identOff = Int(cd.be32(at: 20))
    r.nSpecial = Int(cd.be32(at: 24)); r.nCode = Int(cd.be32(at: 28)); r.codeLimit = Int(cd.be32(at: 32))
    r.identifier = String(decoding: cd[identOff...].prefix { $0 != 0 }, as: UTF8.self)
    let teamOff = Int(cd.be32(at: 48))
    if teamOff > 0 { r.team = String(decoding: cd[teamOff...].prefix { $0 != 0 }, as: UTF8.self) }
    r.execFlags = UInt64(cd.be32(at: 80)) << 32 | UInt64(cd.be32(at: 84))
    return r
}

func verifySigned(_ bin: Data, name: String, expectIdent: String, team: String, info: Data?, resources: Data?, ents: Bool) throws {
    guard let s = readSignature(bin) else { check(false, "\(name): no signature"); return }
    check(s.identifier == expectIdent, "\(name): identifier \(s.identifier) != \(expectIdent)")
    check(s.team == team, "\(name): team \(s.team)")
    var pagesOK = true
    for i in 0..<s.nCode {
        let page = bin.subdata(in: i * 4096..<min((i + 1) * 4096, s.codeLimit))
        if sha256(page) != s.cd.subdata(in: s.hashOff + i * 32..<s.hashOff + i * 32 + 32) { pagesOK = false }
    }
    check(pagesOK && s.nCode > 0, "\(name): code page hashes")
    if let info = info { check(s.special(1) == sha256(info), "\(name): Info.plist slot") }
    if let res = resources { check(s.special(3) == sha256(res), "\(name): CodeResources slot") }
    check(s.special(2) == sha256(s.reqs), "\(name): requirements slot")
    if ents {
        check(s.nSpecial == 7, "\(name): 7 special slots, got \(s.nSpecial)")
        check(s.special(5) == sha256(s.ents), "\(name): entitlements slot")
        check(s.special(7) == sha256(s.entsDER), "\(name): DER entitlements slot")
    }
    // The CMS signature over the CodeDirectory, checked by openssl (not by our own code).
    let d = work.appendingPathComponent("verify-\(name.replacingOccurrences(of: "/", with: "_"))")
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    try s.cms.write(to: d.appendingPathComponent("cms.der"))
    try s.cd.write(to: d.appendingPathComponent("cd.bin"))
    let (rc, _, err) = try run(["openssl", "cms", "-verify", "-noverify", "-binary", "-inform", "DER", "-in", d.path + "/cms.der",
                                "-content", d.path + "/cd.bin", "-out", "/dev/null"])
    check(rc == 0, "\(name): openssl cms -verify: \(err)")
    let (rc2, _, err2) = try run(["openssl", "cms", "-verify", "-binary", "-inform", "DER", "-in", d.path + "/cms.der",
                                  "-content", d.path + "/cd.bin", "-CAfile", fixtures.path + "/ca.pem", "-purpose", "any",
                                  "-out", "/dev/null"])
    check(rc2 == 0, "\(name): chain to the test CA: \(err2)")
}

func entries(_ url: URL) throws -> [String: Data] {
    let z = try ZipReader(url: url)
    var out = [String: Data]()
    for e in z.entries where !e.isDirectory { out[e.name] = try z.data(e) }
    return out
}

let identity = OpenSSLIdentity(keyPath: fixtures.path + "/key.pem", certificate: try fixture("cert.der"),
                               chain: [try fixture("ca.der")])
let team = "TESTTEAM42"

test("sha1 and sha256 vectors") {
    check(hex(sha1(Data("abc".utf8))) == "a9993e364706816aba3e25717850c26c9cd0d89d", "sha1 abc")
    check(hex(sha256(Data("abc".utf8))) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 abc")
    var h = Hasher2()
    var left = 1_000_000
    var size = 1
    while left > 0 { let n = min(size, left); h.update(Data(repeating: 0x61, count: n)); left -= n; size = size * 3 + 7 }
    let (a, b) = h.final()
    check(hex(a) == "34aa973cd4c4daa4f61eeb2bdbad27316534016f", "sha1 million a")
    check(hex(b) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 million a")
}

test("DER entitlements") {
    let d = try EntitlementsDER.encode(["c": 5, "a": true, "b": ["x"]])
    check(hex(d) == "701f020101b01a30060c01610101ff30080c016230030c017830060c0163020105", "got \(hex(d))")
}

test("zip round trip") {
    let url = work.appendingPathComponent("rt.zip")
    let w = try ZipWriter(url: url)
    let big = Data((0..<300_000).map { UInt8($0 % 7) })
    try w.add("d/", Data(), mode: 0o40755)
    try w.add("d/big.bin", big)
    try w.add("d/empty", Data())
    try w.add("d/run", Data("#!/bin/sh\n".utf8), mode: 0o100755)
    w.close()
    let r = try ZipReader(url: url)
    check(r.entries.map(\.name) == ["d/", "d/big.bin", "d/empty", "d/run"], "names \(r.entries.map(\.name))")
    check(try r.data(r.entries[1]) == big, "big file")
    check(r.entries[1].compressedSize < 10_000, "deflated")
    check(r.entries[3].unixMode == 0o100755, "mode")
    let (rc, out, err) = try run(["python3", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip())", url.path])
    check(rc == 0 && String(decoding: out, as: UTF8.self).hasPrefix("None"), "python reads it: \(err)")
}

test("profile rules") {
    let p = try Profile(try fixture("profile.mobileprovision"))
    check(p.team == team && p.appID == "*" && p.isWildcard && p.devices == 3, "fields \(p.team) \(p.appID) \(p.devices)")
    check(try p.bundleID(for: "dev.cydian.fixture") == "dev.cydian.fixture", "wildcard keeps the ID")
    check(p.problem(with: identity.certificate) == nil, "certificate is in the profile")
    check(p.problem(with: try fixture("other.der"))?.code == "cert_not_in_profile", "other certificate refused")
    let e = p.entitlements(for: "dev.cydian.fixture")
    check(e["application-identifier"] as? String == "\(team).dev.cydian.fixture", "application-identifier")
    check(e["keychain-access-groups"] as? [String] == ["\(team).dev.cydian.fixture"], "keychain group narrowed")
    check(e["get-task-allow"].flatMap(plistBool) == false, "never debuggable")
    let x = try Profile(try fixture("profile-explicit.mobileprovision"))
    let xid = try x.bundleID(for: "dev.cydian.fixture")
    check(!x.isWildcard && xid == "com.me.fixture", "explicit renames")
    let pre = try Profile(try fixture("profile-prefix.mobileprovision"))
    check(try pre.bundleID(for: "com.me.tool") == "com.me.tool", "prefix keeps a fitting ID")
    check(try pre.bundleID(for: "io.other.openmx") == "com.me.openmx", "prefix moves the last part")
    let old = try Profile(try fixture("profile-expired.mobileprovision"))
    check(old.problem(with: identity.certificate)?.code == "profile_expired", "expired profile")
    check((try? Profile(Data("not a profile".utf8))) == nil, "garbage refused")
}

test("sign a fixture IPA, wildcard profile") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    let out = work.appendingPathComponent("signed.ipa")
    var phases = Set<String>()
    let app = try signer.sign(fixtures.appendingPathComponent("rich.ipa"), to: out) { phase, _ in phases.insert(phase) }
    check(app.bundleID == "dev.cydian.fixture" && app.name == "Fixture" && app.version == "1.0", "\(app)")
    check(app.removed.isEmpty, "nothing removed: \(app.removed)")
    check(phases == ["reading", "signing"], "progress phases \(phases)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    check(f[a + "embedded.mobileprovision"] == profile.data, "embedded profile")
    check(f[a + "PlugIns/Share.appex/embedded.mobileprovision"] == profile.data, "extension's profile")
    check(f[a + "Frameworks/Kit.framework/embedded.mobileprovision"] == nil, "no profile in a framework")
    check(f[a + "_CodeSignature/CodeResources"] != nil && f[a + "OldStuff/_CodeSignature/CodeResources"] == nil, "old seal gone")
    check(f[a + "hello.txt"] == (try entries(fixtures.appendingPathComponent("rich.ipa")))[a + "hello.txt"], "resources untouched")
    // inner bundles first: the framework, the extension, then the app
    try verifySigned(f[a + "Frameworks/Kit.framework/Kit"]!, name: "Kit", expectIdent: "dev.cydian.kit", team: team,
                     info: f[a + "Frameworks/Kit.framework/Info.plist"], resources: f[a + "Frameworks/Kit.framework/_CodeSignature/CodeResources"], ents: false)
    try verifySigned(f[a + "Frameworks/libloose.dylib"]!, name: "libloose", expectIdent: "libloose", team: team, info: nil, resources: nil, ents: false)
    try verifySigned(f[a + "PlugIns/Share.appex/Share"]!, name: "Share", expectIdent: "dev.cydian.fixture.share", team: team,
                     info: f[a + "PlugIns/Share.appex/Info.plist"], resources: f[a + "PlugIns/Share.appex/_CodeSignature/CodeResources"], ents: true)
    try verifySigned(f[a + "Fixture"]!, name: "Fixture", expectIdent: "dev.cydian.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    let main = readSignature(f[a + "Fixture"]!)!
    check(main.execFlags & 1 == 1, "main binary flag")
    let ents = try PropertyListSerialization.propertyList(from: main.ents.subdata(in: 8..<main.ents.count), format: nil) as? [String: Any]
    check(ents?["application-identifier"] as? String == "\(team).dev.cydian.fixture", "app entitlements")
    // CodeResources seals every file with its final hash, nested bundles' signed files included
    let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
    let files2 = cr["files2"] as! [String: Any]
    let kit = files2["Frameworks/Kit.framework/Kit"] as? [String: Any]
    check(kit?["hash2"] as? Data == sha256(f[a + "Frameworks/Kit.framework/Kit"]!), "nested binary sealed after signing")
    check(files2["Info.plist"] == nil && files2["Fixture"] == nil, "Info.plist and the executable aren't in files2")
    check((files2["en.lproj/Localizable.strings"] as? [String: Any])?["optional"].flatMap(plistBool) == true, "lproj optional")
    check((files2["link.txt"] as? [String: Any])?["symlink"] as? String == "hello.txt", "symlink sealed as a link")
    let r = try ZipReader(url: out)
    check(r.entries.first { $0.name == a + "link.txt" }?.isSymlink == true, "symlink kept")
    check(r.entries.first { $0.name == a + "Fixture" }?.unixMode == 0o100755, "executable stays executable")
}

test("re-sign a signed IPA (the old LC_CODE_SIGNATURE is replaced)") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let out = work.appendingPathComponent("resigned.ipa")
    _ = try IPASigner(profile: profile, identity: identity).sign(work.appendingPathComponent("signed.ipa"), to: out)
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    let before = try entries(work.appendingPathComponent("signed.ipa"))[a + "Fixture"]!
    check(f[a + "Fixture"]!.count == before.count, "same size: the signature is replaced, not added")
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-resigned", expectIdent: "dev.cydian.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
}

test("sign with an explicit profile: renamed, extensions removed") {
    let profile = try Profile(try fixture("profile-explicit.mobileprovision"))
    let out = work.appendingPathComponent("signed-explicit.ipa")
    let app = try IPASigner(profile: profile, identity: identity).sign(fixtures.appendingPathComponent("rich.ipa"), to: out)
    check(app.bundleID == "com.me.fixture" && app.originalBundleID == "dev.cydian.fixture", "\(app.bundleID)")
    check(app.removed == ["PlugIns/Share.appex"], "removed \(app.removed)")
    let f = try entries(out)
    let a = "Payload/Fixture.app/"
    check(!f.keys.contains { $0.contains("PlugIns/") }, "no PlugIns left")
    let info = try PropertyListSerialization.propertyList(from: f[a + "Info.plist"]!, format: nil) as? [String: Any]
    check(info?["CFBundleIdentifier"] as? String == "com.me.fixture", "Info.plist renamed")
    try verifySigned(f[a + "Fixture"]!, name: "Fixture-explicit", expectIdent: "com.me.fixture", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
}

test("an unsigned binary gets LC_CODE_SIGNATURE") {
    let bin = try fixture("unsigned.macho")
    let signed = try MachO.sign(bin, CodeSignParams(identifier: "x.y", team: team), identity)
    try verifySigned(signed, name: "unsigned", expectIdent: "x.y", team: team, info: nil, resources: nil, ents: false)
    let fat = try fixture("fat.macho")
    let sf = try MachO.sign(fat, CodeSignParams(identifier: "fat", team: team), identity)
    check(sf.be32(at: 0) == MachO.fatMagic && sf.be32(at: 4) == 1, "fat keeps only the arm64 slice")
    let off = Int(sf.be32(at: 16)), size = Int(sf.be32(at: 20))
    try verifySigned(sf.subdata(in: off..<off + size), name: "fat", expectIdent: "fat", team: team, info: nil, resources: nil, ents: false)
}

if let real = ProcessInfo.processInfo.environment["CYDIAN_REAL_IPA"], FileManager.default.fileExists(atPath: real) {
    test("sign a real IPA (native/build/Cydian.ipa)") {
        let profile = try Profile(try fixture("profile.mobileprovision"))
        let out = work.appendingPathComponent("real-signed.ipa")
        let app = try IPASigner(profile: profile, identity: identity).sign(URL(fileURLWithPath: real), to: out)
        check(app.bundleID == "com.ryha.cydian", "bundle id \(app.bundleID)")
        let f = try entries(out)
        let a = "Payload/Cydian.app/"
        try verifySigned(f[a + "Cydian"]!, name: "Cydian", expectIdent: "com.ryha.cydian", team: team,
                         info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    }
}

test("refusals") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    for (name, code) in [("notanipa.ipa", "bad_ipa"), ("escape.ipa", "bad_ipa"), ("encrypted.ipa", "encrypted")] {
        do {
            _ = try signer.sign(fixtures.appendingPathComponent(name), to: work.appendingPathComponent("x.ipa"))
            check(false, "\(name) signed")
        } catch let e as SignError { check(e.code == code, "\(name): \(e)") }
    }
}

test("B21: a nested bundle or framework without its executable is sealed as resources, not an error") {
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let signer = IPASigner(profile: profile, identity: identity)
    var logged = [String]()
    signer.log = { logged.append($0) }
    let out = work.appendingPathComponent("missing-exe-signed.ipa")
    let app = try signer.sign(fixtures.appendingPathComponent("missing-exe.ipa"), to: out)
    check(app.skipped == ["Frameworks/Kit.framework", "YTUHD.bundle"], "skipped \(app.skipped)")
    check(logged.contains("Skipped YTUHD.bundle: its executable YTUHD is missing, sealed as resources"), "log \(logged)")
    check(logged.contains { $0.hasPrefix("Signed Tiny.app (") } && logged.contains { $0.hasPrefix("Read ") }, "console log \(logged)")
    let f = try entries(out)
    let a = "Payload/Tiny.app/"
    check(f[a + "YTUHD.bundle/_CodeSignature/CodeResources"] == nil && f[a + "YTUHD.bundle/YTUHD"] == nil, "nothing made in the bundle")
    check(f[a + "Frameworks/Kit.framework/_CodeSignature/CodeResources"] == nil, "no seal of its own in the framework")
    try verifySigned(f[a + "Tiny"]!, name: "Tiny-missing-exe", expectIdent: "com.ryha.cydian", team: team,
                     info: f[a + "Info.plist"], resources: f[a + "_CodeSignature/CodeResources"], ents: true)
    let cr = try PropertyListSerialization.propertyList(from: f[a + "_CodeSignature/CodeResources"]!, format: nil) as! [String: Any]
    let files2 = cr["files2"] as! [String: Any]
    for rel in ["YTUHD.bundle/Info.plist", "Frameworks/Kit.framework/Info.plist", "Frameworks/Kit.framework/kit.txt"] {
        check((files2[rel] as? [String: Any])?["hash2"] as? Data == sha256(f[a + rel]!), "\(rel) sealed by the app")
    }
    check((files2["YTUHD.bundle/en.lproj/Localizable.strings"] as? [String: Any])?["optional"].flatMap(plistBool) == true, "lproj in the bundle")
    // The app's own executable missing is still an error.
    do {
        _ = try signer.sign(fixtures.appendingPathComponent("noexe.ipa"), to: work.appendingPathComponent("x.ipa"))
        check(false, "an app without its executable signed")
    } catch let e as SignError { check(e.code == "bad_ipa" && "\(e)".contains("X is missing"), "\(e)") }
}

test("HTTP requests and ranges") {
    check(try HTTPRequest.parse(Data("GET /a HTTP/1.1\r\nHost: x".utf8)) == nil, "incomplete header waits")
    let r = try HTTPRequest.parse(Data("GET /t/app.ipa?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=10-19\r\n\r\n".utf8))!
    check(r.method == "GET" && r.path == "/t/app.ipa", "\(r.method) \(r.path)")
    check(r.range(size: 100) == .some(10...19), "range a-b")
    let h = { (v: String) in HTTPRequest(method: "GET", path: "/", headers: ["range": v]) }
    check(h("bytes=90-").range(size: 100) == .some(90...99), "range a-")
    check(h("bytes=-5").range(size: 100) == .some(95...99), "suffix range")
    check(h("bytes=50-500").range(size: 100) == .some(50...99), "clamped")
    check(h("bytes=100-").range(size: 100) == nil, "past the end is unsatisfiable")
    check(HTTPRequest(method: "GET", path: "/", headers: [:]).range(size: 100) == .some(nil), "no range: everything")
    check((try? HTTPRequest.parse(Data("NONSENSE\r\n\r\n".utf8))) == nil, "bad request line refused")
    let head = String(decoding: HTTPResponse.head(206, [("Content-Length", "10")]), as: UTF8.self)
    check(head.hasPrefix("HTTP/1.1 206 Partial Content\r\n") && head.hasSuffix("\r\n\r\n"), head)
}

test("B29: the IPA counts as served only once every byte went out, over all requests") {
    // A 42.7 MB IPA as iOS's installer may fetch it: the zip's end first, then the whole file cut short and resumed.
    let size: UInt64 = 43_709_494
    var c = ByteCoverage()
    check(!c.covers(size: size) && c.count == 0, "nothing sent")
    c.add(size - 65_536...size - 1)
    check(!c.covers(size: size), "the end alone (it reaches the last byte) isn't the whole IPA")
    c.add(0...20_000_000)
    check(!c.covers(size: size) && c.ranges.count == 2, "a gap left: \(c.ranges)")
    c.add(20_000_001...size - 65_537)
    check(c.covers(size: size) && c.ranges == [0...size - 1], "touching ranges joined: \(c.ranges)")
    check(c.count == size, "each byte counted once: \(c.count)")
    var d = ByteCoverage()
    d.add(0...size - 1); d.add(100...200)
    check(d.covers(size: size) && d.count == size, "a repeat adds nothing")
    var e = ByteCoverage()
    e.add(10...19); e.add(0...4); e.add(5...9)
    check(e.ranges == [0...19] && e.covers(size: 20) && !e.covers(size: 21), "\(e.ranges)")
    check(ByteCoverage().covers(size: 0), "an empty file")
}

test("manifest and itms link") {
    let m = try InstallManifest.manifest(ipaURL: "http://127.0.0.1:4242/t/app.ipa", bundleID: "dev.cydian.fixture", version: "1.0", title: "Fixture")
    let pl = try PropertyListSerialization.propertyList(from: m, format: nil) as? [String: Any]
    let item = (pl?["items"] as? [[String: Any]])?.first
    check(((item?["assets"] as? [[String: Any]])?.first?["url"] as? String) == "http://127.0.0.1:4242/t/app.ipa", "asset url")
    check((item?["metadata"] as? [String: Any])?["bundle-identifier"] as? String == "dev.cydian.fixture", "bundle id")
    check(InstallManifest.itmsURL(manifest: "https://cydian.dev/sign/manifest?bundleid=a.b&port=4242")
          == "itms-services://?action=download-manifest&url=https%3A%2F%2Fcydian.dev%2Fsign%2Fmanifest%3Fbundleid%3Da.b%26port%3D4242", "itms link")
}

test("F77: My IPAs signs a local IPA file") {
    let A = "Payload/Fixture.app/"
    let lib = IPALibrary(root: work.appendingPathComponent("lib/Documents"), store: work.appendingPathComponent("lib/Store"))
    check(IPALibrary.safeName("https://x.test/dl/My%20App.IPA") == "My App.ipa", "safe name \(IPALibrary.safeName("https://x.test/dl/My%20App.IPA"))")
    check(IPALibrary.safeName("../../.hidden") == "hidden.ipa", "no folders, no dots: \(IPALibrary.safeName("../../.hidden"))")
    check(IPALibrary.safeName("") == "App.ipa", "empty")
    check(!IPALibrary.validName("../x.ipa") && !IPALibrary.validName(".x.ipa") && !IPALibrary.validName("x.zip") && IPALibrary.validName("A b.ipa"), "valid names")
    let a = try lib.add(fixtures.appendingPathComponent("rich.ipa"), name: "Rich.ipa", move: false)
    let b = try lib.add(fixtures.appendingPathComponent("notanipa.ipa"), name: "Rich.ipa", move: false)
    check(a == "Rich.ipa" && b == "Rich 2.ipa", "unique names \(a) \(b)")
    check(lib.files() == ["Rich.ipa", "Rich 2.ipa"], "files \(lib.files())")
    let d = try lib.details(a)
    check(d.name == "Fixture" && d.bundleID == "dev.cydian.fixture" && d.error == nil, "details \(d.name) \(d.bundleID) \(d.error ?? "")")
    check(!d.extensions.isEmpty, "extensions read")
    check(try lib.details(b).error != nil, "a zip that isn't an IPA is listed with an error")
    let cert = identity.certificate
    check(lib.signed(a, certificate: cert) == nil, "not signed yet")
    check(lib.json(a, certificate: cert)["signed"] is NSNull, "json: not signed")
    let profile = try Profile(try fixture("profile.mobileprovision"))
    let s = try lib.sign(a, signer: IPASigner(profile: profile, identity: identity), certificate: cert, expires: nil, work: work)
    check(s.bundleID == "dev.cydian.fixture", "signed as \(s.bundleID)")
    check(lib.signed(a, certificate: cert) != nil, "signed, ready to install")
    check(lib.signed(a, certificate: try fixture("other.der")) == nil, "another certificate: not signed")
    check(lib.signed(a, certificate: nil) == nil, "no certificate: not signed")
    let f = try entries(lib.signedURL(a))
    try verifySigned(f[A + "Fixture"]!, name: "Fixture", expectIdent: "dev.cydian.fixture", team: team,
                     info: f[A + "Info.plist"], resources: f[A + "_CodeSignature/CodeResources"], ents: true)
    check(try entries(lib.root.appendingPathComponent(a))[A + "_CodeSignature/CodeResources"] == Data("old seal".utf8), "the IPA itself stays as added")
    // New Sign Options: the signed copy no longer fits and goes.
    var o = SignOptions()
    o.name = "Renamed"
    try lib.setOptions(a, o)
    check(lib.signed(a, certificate: cert) == nil && !FileManager.default.fileExists(atPath: lib.signedURL(a).path), "options changed: re-sign")
    let s2 = try lib.sign(a, signer: IPASigner(profile: profile, identity: identity), certificate: cert,
                          expires: Date(timeIntervalSinceNow: 3600), work: work)
    check(s2.name == "Renamed" && lib.options(a).name == "Renamed", "signed with the options")
    check(lib.signed(a, certificate: cert, now: Date(timeIntervalSinceNow: 7200)) == nil, "expired: not signed")
    // The IPA replaced in Files: the copy doesn't fit.
    try FileManager.default.removeItem(at: lib.root.appendingPathComponent(a))
    try FileManager.default.copyItem(at: fixtures.appendingPathComponent("rich.ipa"), to: lib.root.appendingPathComponent(a))
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: 60)], ofItemAtPath: lib.root.appendingPathComponent(a).path)
    check(lib.signed(a, certificate: cert) == nil, "replaced IPA: not signed")
    try lib.delete(a)
    check(lib.files() == ["Rich 2.ipa"] && !FileManager.default.fileExists(atPath: lib.signedURL(a).path), "deleted with its copy")
    try FileManager.default.removeItem(at: lib.root.appendingPathComponent(b))
    lib.sweep()
    check(((try? FileManager.default.contentsOfDirectory(atPath: lib.store.path)) ?? ["x"]).isEmpty, "sweep clears leftovers")
}

print(failures == 0 ? "all passed" : "\(failures) failure(s)")
exit(failures == 0 ? 0 : 1)
