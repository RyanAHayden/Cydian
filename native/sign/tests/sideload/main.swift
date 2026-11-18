// Swift tests for F14's parts of the on-device signer, run on Linux by native/test_sideload.py: profile kinds, the
// user's edits while signing (name, bundle ID across extensions, icon, extensions left out), the arm64e fix-up,
// the IPA inspector, OCSP, the re-sign reminder and the record of signed apps.
//   sideloadtest <fixtures dir> <work dir>
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: sideloadtest <fixtures> <work>"); exit(2) }
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
func fixture(_ name: String) throws -> Data { try Data(contentsOf: fixtures.appendingPathComponent(name)) }
func throwsCode(_ code: String, _ f: () throws -> Void) -> Bool {
    do { try f(); return false } catch let e as SignError { return e.code == code } catch { return false }
}

// openssl holds the key, as in native/sign/tests/main.swift.
struct OpenSSLIdentity: SigningIdentity {
    let keyPath: String
    let certificate: Data
    let chain: [Data]
    var signatureAlgorithm: String { "1.2.840.113549.1.1.1" }
    func sign(_ message: Data) throws -> Data {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["openssl", "dgst", "-sha256", "-sign", keyPath]
        let out = Pipe(), inp = Pipe()
        p.standardOutput = out; p.standardInput = inp
        try p.run()
        inp.fileHandleForWriting.write(message)
        inp.fileHandleForWriting.closeFile()
        let sig = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { throw SignError("openssl", "dgst failed") }
        return sig
    }
}

let cert = try fixture("cert.der")
let identity = OpenSSLIdentity(keyPath: fixtures.path + "/key.pem", certificate: cert, chain: [try fixture("ca.der")])
let utc: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()
func day(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

test("profile kinds") {
    check(try Profile(fixture("profile.mobileprovision")).kind == .development, "get-task-allow: Development")
    check(try Profile(fixture("kind-adhoc.mobileprovision")).kind == .adHoc, "devices: Ad Hoc")
    check(try Profile(fixture("kind-enterprise.mobileprovision")).kind == .enterprise, "all devices: Enterprise")
    check(try Profile(fixture("kind-distribution.mobileprovision")).kind == .distribution, "none: Distribution")
}

test("signature expiry is the earlier of profile and certificate") {
    let p = try Profile(fixture("profile.mobileprovision")) // 7 days; the certificate a year
    check(p.signatureExpiry(certificate: cert) == p.expires, "profile first")
    let far = try Profile(fixture("kind-adhoc.mobileprovision")) // 2030
    check(far.signatureExpiry(certificate: cert) == (try Certificate(der: cert)).notAfter, "certificate first")
}

test("options from the bridge") {
    let png = try fixture("icon.png")
    let o = try SignOptions(json: ["name": "  New  ", "bundleId": "com.me.x-1", "icon": png.base64EncodedString(),
                                   "removeExtensions": ["PlugIns/W.appex/"], "fixArm64e": false])
    check(o.name == "New" && o.bundleID == "com.me.x-1" && o.icon == png, "fields")
    check(o.removeExtensions == ["PlugIns/W.appex"] && !o.fixArm64e, "extensions, fix-up")
    check(try SignOptions(json: ["name": "", "bundleId": ""]).name == nil, "empty is none")
    for bad in ["com..x", ".com.x", "com.x.", "com x", "com.é"] {
        check(throwsCode("bad_options") { _ = try SignOptions(json: ["bundleId": bad]) }, "refuses \(bad)")
    }
    check(throwsCode("bad_options") { _ = try SignOptions(json: ["icon": Data("GIF89a".utf8).base64EncodedString()]) }, "icon not PNG")
}

test("strings files") {
    let d = SignOptions.parseStrings("/* c */ \"a\" = \"x \\\"y\\\"\\n\";\n// line\nb = c;\n\"u\" = \"\\U00e9\";")
    check(d?["a"] as? String == "x \"y\"\n" && d?["b"] as? String == "c" && d?["u"] as? String == "é", "\(String(describing: d))")
    check(SignOptions.parseStrings("\"a\" = \"b\"") == nil, "missing ; is not a strings file")
    var o = SignOptions()
    o.name = "N"
    let utf16 = "\"CFBundleName\" = \"Alt\";".data(using: .utf16)!
    let r = o.renamedStrings(utf16).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: String] }
    check(r == ["CFBundleName": "N"], "utf-16 renamed: \(String(describing: r))")
    check(o.renamedStrings(Data("\"Other\" = \"x\";".utf8)) == nil, "untouched without a name key")
}

test("arm64e fix-up") {
    let old = try fixture("arm64e-old.macho")
    let (fixed, changed) = Arm64e.fixup(old)
    check(changed, "old ABI fixed")
    let off = Int(fixed.be32(at: 8 + 20 + 8))
    check(fixed.be32(at: 8 + 20 + 4) == 0x8000_0002 && fixed.le32(at: off + 8) == 0x8000_0002, "both headers")
    check(fixed.be32(at: 8 + 4) == 0, "arm64 slice untouched")
    check(fixed.count == old.count, "same size")
    check(!Arm64e.fixup(try fixture("arm64e-new.macho")).1, "versioned slice left alone")
    let thin = old.subdata(in: 0x4000..<0x4000 + 64)
    check(!Arm64e.fixup(thin).1, "thin left alone")
}

test("inspect an IPA") {
    let d = try Inspect.ipa(fixtures.appendingPathComponent("edit.ipa"))
    check(d.name == "Fixture" && d.bundleID == "dev.cydian.fixture" && d.version == "1.0" && d.minimumOS == "15.0", "basics")
    check(d.permissions.map(\.label) == ["Camera", "Local Network"], "permissions \(d.permissions.map(\.label))")
    check(d.permissions.first?.text == "To scan codes.", "the app's reason")
    check(d.extensions.map(\.path) == ["PlugIns/Share.appex", "PlugIns/Widget.appex"], "extensions \(d.extensions.map(\.path))")
    check(d.extensions.first?.point == "com.apple.share-services" && d.extensions.first?.bundleID == "dev.cydian.fixture.share", "share")
    check(d.iconPath == "Payload/Fixture.app/AppIcon60x60@2x.png", "icon \(String(describing: d.iconPath))")
    check(d.entitlements.isEmpty, "unsigned: no entitlements")
    check(JSONSerialization.isValidJSONObject(d.json), "json")
    check((try? Inspect.ipa(fixtures.appendingPathComponent("icon.png"))) == nil, "not a zip")
}

test("sign with the user's edits") {
    let profile = try Profile(fixture("profile.mobileprovision"))
    let s = IPASigner(profile: profile, identity: identity)
    s.options = try SignOptions(json: ["name": "Renamed", "bundleId": "com.me.renamed", "icon": try fixture("icon.png").base64EncodedString(),
                                       "removeExtensions": ["PlugIns/Widget.appex"]])
    let out = work.appendingPathComponent("edited.ipa")
    let app = try s.sign(fixtures.appendingPathComponent("edit.ipa"), to: out)
    check(app.bundleID == "com.me.renamed" && app.originalBundleID == "dev.cydian.fixture", "ids \(app.bundleID)")
    check(app.name == "Renamed", "name \(app.name)")
    check(app.removed == ["PlugIns/Widget.appex"], "removed \(app.removed)")
    check(app.fixedArm64e == ["Frameworks/Sub.framework/Sub"], "fixed \(app.fixedArm64e)")
    // read back: the signed app's own entitlements, now the profile's narrowed to the new ID
    let d = try Inspect.ipa(out)
    check(d.entitlements["application-identifier"] as? String == "TESTTEAM42.com.me.renamed", "entitlements \(d.entitlements)")
    check(d.extensions.map(\.bundleID) == ["com.me.renamed.share"], "extension moved")
    check(d.iconPath == "Payload/Fixture.app/CydianIcon60x60@3x.png", "icon \(String(describing: d.iconPath))")
    check(d.missing(from: profile).isEmpty, "the profile covers what it signed")
    let wants = AppDetails(name: "", bundleID: "", version: "", minimumOS: "", executable: "",
                           entitlements: ["com.apple.developer.healthkit": true, "get-task-allow": true,
                                          "keychain-access-groups": ["x"]],
                           permissions: [], extensions: [], iconPath: nil, size: 0)
    check(wants.missing(from: profile) == ["com.apple.developer.healthkit"], "missing \(wants.missing(from: profile))")
    // an unknown extension is refused; an explicit profile overrides the asked-for ID
    s.options = try SignOptions(json: ["removeExtensions": ["PlugIns/Nope.appex"]])
    check(throwsCode("bad_options") { _ = try s.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("x.ipa")) },
          "unknown extension")
    let explicit = IPASigner(profile: try Profile(fixture("profile-explicit.mobileprovision")), identity: identity)
    explicit.options = try SignOptions(json: ["bundleId": "com.me.asked"])
    let e = try explicit.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("explicit.ipa"))
    check(e.bundleID == "com.me.only" && e.removed.sorted() == ["PlugIns/Share.appex", "PlugIns/Widget.appex"], "explicit \(e.bundleID) \(e.removed)")
    // no options: the plain I6 behaviour, no fix-up when turned off
    let plain = IPASigner(profile: profile, identity: identity)
    plain.options.fixArm64e = false
    let p = try plain.sign(fixtures.appendingPathComponent("edit.ipa"), to: work.appendingPathComponent("plain.ipa"))
    check(p.bundleID == "dev.cydian.fixture" && p.name == "Fixture" && p.fixedArm64e.isEmpty && p.removed.isEmpty, "plain")
}

test("OCSP") {
    let ca = try fixture("ca.der")
    let req = try OCSP.request(certificate: cert, issuer: ca)
    try req.write(to: work.appendingPathComponent("ocsp-request.der")) // Python reads it with cryptography
    check(OCSP.responder(try fixture("aia.der"))?.absoluteString == "http://ocsp.apple.com/ocsp03-wwdrg305", "AIA")
    check(OCSP.responder(cert) == nil, "no AIA")
    check(try OCSP.status(fixture("ocsp-good.der"), certificate: cert) == .good, "good")
    check(try OCSP.status(fixture("ocsp-revoked.der"), certificate: cert) == .revoked(day("2026-11-01T12:00:00Z")), "revoked with its time")
    check(try OCSP.status(fixture("ocsp-unknown.der"), certificate: cert) == .unknown, "unknown")
    check(try OCSP.status(fixture("ocsp-good.der"), certificate: fixture("other.der")) == .unknown, "another certificate's answer")
    check(throwsCode("ocsp") { _ = try OCSP.status(fixture("ocsp-trylater.der"), certificate: cert) }, "tryLater")
    check(throwsCode("ocsp") { _ = try OCSP.status(Data([0x30, 0x03, 0x02, 0x01, 0x00]), certificate: cert) }, "garbage")
}

test("re-sign reminder") {
    let expiry = day("2026-11-24T08:00:00Z")
    let now = day("2026-11-17T12:00:00Z")
    check(Reminder.date(expiry: expiry, daysBefore: 2, now: now, calendar: utc) == day("2026-11-22T10:00:00Z"), "two days before, 10:00")
    check(Reminder.date(expiry: expiry, daysBefore: 0, now: now, calendar: utc) == nil, "off")
    check(Reminder.date(expiry: expiry, daysBefore: 7, now: now, calendar: utc) == nil, "already past")
    check(Reminder.text(apps: ["Delta"], expiry: expiry, now: now, calendar: utc).body
          == "Delta stops opening in 7 days. Open Cydian and tap Re-sign All.", "one app")
    check(Reminder.text(apps: ["A", "B", "C"], expiry: day("2026-11-18T08:00:00Z"), now: now, calendar: utc).body
          == "A and 2 other apps stop opening tomorrow. Open Cydian and tap Re-sign All.", "three apps")
    check(Reminder.text(apps: [], expiry: now, now: now, calendar: utc).body.hasPrefix("Your signing certificate stops opening today"), "none")
}

test("signed records") {
    var o = SignOptions()
    o.name = "D"; o.icon = Data([1, 2]); o.removeExtensions = ["PlugIns/X.appex"]
    let a = SignedRecord(bundleID: "a", originalBundleID: "a0", name: "A", version: "1", url: "https://x/a.ipa",
                         signed: day("2026-11-17T00:00:00Z"), expires: day("2026-11-24T00:00:00Z"), options: o.stored)
    var b = a
    b.bundleID = "b"; b.name = "B"; b.expires = day("2026-11-24T05:00:00Z")
    var c = a
    c.bundleID = "c"; c.name = "C"; c.expires = day("2027-01-01T00:00:00Z")
    var list = SignedRecords.adding(a, to: [])
    list = SignedRecords.adding(b, to: list)
    list = SignedRecords.adding(c, to: list)
    var a2 = a
    a2.version = "2"
    list = SignedRecords.adding(a2, to: list)
    check(list.map(\.bundleID) == ["b", "c", "a"] && list.last?.version == "2", "replaced \(list.map(\.bundleID))")
    let back = SignedRecords.decode(try SignedRecords.encode(list))
    check(back == list, "round trip")
    check(SignOptions(back[2].options).removeExtensions == ["PlugIns/X.appex"] && SignOptions(back[2].options).icon == Data([1, 2]), "options back")
    let next = SignedRecords.nextExpiry(list)
    check(next?.0 == day("2026-11-24T00:00:00Z") && next?.1.sorted() == ["A", "B"], "next \(String(describing: next))")
    check(SignedRecords.decode(Data("nope".utf8)).isEmpty, "bad file: empty")
    check(JSONSerialization.isValidJSONObject(a.json), "json")
}

// F75: Cydian's own IPA with the user's certificate inside (BundledIdentity), the cydian:// links the shell takes,
// and gunzip for cydian://import on an iOS without DecompressionStream.
test("bundled identity: first launch imports, once") {
    let plist = try PropertyListSerialization.data(fromPropertyList: ["p12": Data([0x30, 1, 2]), "password": "pw",
                                                                      "profile": Data([0x30, 9])], format: .xml, options: 0)
    let c = BundledIdentity.parse(plist)
    check(c?.p12 == Data([0x30, 1, 2]) && c?.password == "pw" && c?.profile == Data([0x30, 9]), "parsed")
    check(BundledIdentity.parse(Data("nope".utf8)) == nil, "not a plist")
    let noProfile = try PropertyListSerialization.data(fromPropertyList: ["p12": Data([1])], format: .xml, options: 0)
    check(BundledIdentity.parse(noProfile) == nil, "no profile")
    let d = BundledIdentity.digest(plist)
    check(d.count == 64, "sha-256 hex")
    check(BundledIdentity.shouldImport(digest: d, seen: nil, hasIdentity: false), "first launch, empty Keychain: import")
    check(!BundledIdentity.shouldImport(digest: d, seen: nil, hasIdentity: true), "Keychain holds one: keep it")
    check(!BundledIdentity.shouldImport(digest: d, seen: d, hasIdentity: false), "same file again (removed since): ignored")
    check(BundledIdentity.shouldImport(digest: "other", seen: d, hasIdentity: false), "an update's new file, empty Keychain: import")
}

test("incoming cydian:// links") {
    check(IncomingLink.accepts(URL(string: "cydian://import?d=H4sI")!), "import")
    check(IncomingLink.accepts(URL(string: "cydian://signing-import#abc")!), "signing-import")
    check(!IncomingLink.accepts(URL(string: "cydian://other")!), "other host")
    check(IncomingLink.accepts(URL(string: "cydian://myipas?file=A.ipa")!), "myipas (F77)")
    check(!IncomingLink.accepts(URL(string: "https://import/x")!), "other scheme")
    check(!IncomingLink.accepts(URL(string: "cydian://import?d=" + String(repeating: "A", count: 600_000))!), "too long")
}

test("gunzip") {
    let a = try gunzip(Data(base64Encoded: "H4sIAAAAAAAC/6tWKlOyMtRRKs4vLUpOLVayilbKKCkpKLbS1y9KLcjXS61IzC3ISdVXiq0FAGw/tQcrAAAA")!)
    check(String(decoding: a, as: UTF8.self) == #"{"v":1,"sources":["https://repo.example/"]}"#, "plain member")
    let b = try gunzip(Data(base64Encoded: "H4sICAAAAAAC/2EuanNvbgDLS8xNTQEAh8zgcQUAAAA=")!)
    check(String(decoding: b, as: UTF8.self) == "named", "with a file name")
    var bad = [UInt8](Data(base64Encoded: "H4sICAAAAAAC/2EuanNvbgDLS8xNTQEAh8zgcQUAAAA=")!)
    bad[bad.count - 6] ^= 1
    check((try? gunzip(Data(bad))) == nil, "crc checked")
    check((try? gunzip(Data("not gzip at all, long enough".utf8))) == nil, "not gzip")
}

if failures == 0 { print("all passed") } else { print("\(failures) failed"); exit(1) }
