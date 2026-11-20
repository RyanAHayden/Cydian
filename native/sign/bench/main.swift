// Times the on-device signer (native/sign/) on a real IPA, stage by stage: open (the zip's directory), reading
// (inflate + SHA-1/SHA-256 of every file), signing (Mach-O signatures, CodeResources) and writing (the new zip).
// Built for the phone by native/sign/bench/build.sh, or for Linux; R41's notes (journal) used it on the iPhone 7.
//   signbench <in.ipa> <out.ipa> <key.der> <cert.der> <profile.mobileprovision> [bundle ID]
// key.der is a PKCS#1 RSA private key, cert.der its certificate (throwaway ones from native/testkit.py); the profile
// should be a wildcard one so the app keeps its extensions. A bundle ID other than the app's signs it as a new app.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
#if canImport(Security)
import Security
#endif

let args = CommandLine.arguments
// signbench --codec <file>: how long one file takes to deflate at levels 1, 6 and 9, to hash (SHA-1 + SHA-256, as
// CodeResources wants) and to CRC.
if args.count == 3 && args[1] == "--codec" {
    let d = try Data(contentsOf: URL(fileURLWithPath: args[2]))
    func time(_ what: String, _ f: () throws -> Int) rethrows {
        let s = Date()
        let n = try f()
        let t = Date().timeIntervalSince(s)
        print(String(format: "%-10@ %6.2fs  %6.1f MB/s  -> %.1f MB", what as NSString, t, Double(d.count) / 1e6 / t, Double(n) / 1e6))
    }
    try time("sha1+256") { var h = Hasher2(); h.update(d); _ = h.final(); return d.count }
    try time("crc32") { _ = crc32Of(d); return d.count }
    for level: Int32 in [1, 6, 9] { try time("deflate \(level)") { try deflateData(d, level: level).count } }
    exit(0)
}
guard args.count >= 6 else {
    print("usage: signbench <in.ipa> <out.ipa> <key.der> <cert.der> <profile.mobileprovision> [bundle ID]")
    exit(2)
}

struct BenchIdentity: SigningIdentity {
    let keyDER: Data
    let certificate: Data
    var chain: [Data] { [] }
    var signatureAlgorithm: String { "1.2.840.113549.1.1.1" }
    func sign(_ message: Data) throws -> Data {
        #if canImport(Security)
        // As the app's KeychainIdentity does: SecKey, PKCS#1 v1.5 over SHA-256.
        var err: Unmanaged<CFError>?
        let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeRSA, kSecAttrKeyClass as String: kSecAttrKeyClassPrivate]
        guard let key = SecKeyCreateWithData(keyDER as CFData, attrs as CFDictionary, &err),
              let sig = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, message as CFData, &err) else {
            throw SignError("bench", "SecKey: \(String(describing: err?.takeRetainedValue()))")
        }
        return sig as Data
        #else
        return Data(count: 256) // Linux: the shape only; the bench is about the time around it
        #endif
    }
}

let t0 = Date()
func stamp() -> String { String(format: "%7.2fs", Date().timeIntervalSince(t0)) }
func size(_ u: URL) -> String {
    let n = ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? NSNumber)?.int64Value ?? 0
    return String(format: "%.1f MB", Double(n) / 1e6)
}

let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
do {
    let profile = try Profile(Data(contentsOf: URL(fileURLWithPath: args[5])))
    let id = BenchIdentity(keyDER: try Data(contentsOf: URL(fileURLWithPath: args[3])),
                           certificate: try Data(contentsOf: URL(fileURLWithPath: args[4])))
    let signer = IPASigner(profile: profile, identity: id)
    if args.count > 6 { signer.options.bundleID = args[6] }
    // SIGNBENCH_LEVEL (0 store, 1-9 deflate) and SIGNBENCH_READERS (threads reading the IPA) override the signer's own.
    let env = ProcessInfo.processInfo.environment
    if let l = env["SIGNBENCH_LEVEL"].flatMap({ Int32($0) }) { signer.level = l }
    if let r = env["SIGNBENCH_READERS"].flatMap({ Int($0) }) { signer.readers = max(1, r) }
    print("\(stamp())  level \(signer.level), \(signer.readers) readers")
    var phase = "", lastPrint = Date.distantPast
    var marks = [(String, Date)]()
    var lastSigned = t0 // the app is signed last: its "Signed" line ends the signing stage
    signer.log = { line in print("\(stamp())  \(line)"); if line.hasPrefix("Signed ") { lastSigned = Date() } }
    print("\(stamp())  start \(input.lastPathComponent) (\(size(input)))")
    let app = try signer.sign(input, to: output) { p, f in
        if p != phase { phase = p; marks.append((p, Date())); print("\(stamp())  phase \(p)") }
        if Date().timeIntervalSince(lastPrint) > 2 { lastPrint = Date(); print("\(stamp())    \(p) \(Int(f * 100))%") }
    }
    let end = Date()
    marks.append(("writing", lastSigned))
    marks.append(("end", end))
    print("\(stamp())  done \(app.bundleID) -> \(output.lastPathComponent) (\(size(output)))")
    // Stage lengths: each mark ends the stage before it (open, reading, signing, writing).
    var prev = (name: "open", at: t0)
    for m in marks {
        print("STAGE \(prev.name.padding(toLength: 8, withPad: " ", startingAt: 0)) " + String(format: "%7.2fs", m.1.timeIntervalSince(prev.at)))
        prev = (m.0, m.1)
    }
    print(String(format: "TOTAL %7.2fs", end.timeIntervalSince(t0)))
    var ru = rusage()
    getrusage(0, &ru) // RUSAGE_SELF
    #if canImport(Darwin)
    let peak = Double(ru.ru_maxrss) / 1e6 // bytes on Darwin
    #else
    let peak = Double(ru.ru_maxrss) / 1e3 // KB on Linux
    #endif
    print(String(format: "PEAK  %7.0f MB", peak))
} catch {
    print("\(stamp())  FAILED \(error)")
    exit(1)
}
