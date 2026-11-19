// F237 phone check: sign an IPA with native/sign's IPASigner, Keep Bundle IDs on or off.
//   f237sign FX IN OUT keep|old
import Foundation

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
let a = CommandLine.arguments
let fx = URL(fileURLWithPath: a[1])
let id = OpenSSLIdentity(keyPath: fx.appendingPathComponent("key.pem").path,
                         certificate: try Data(contentsOf: fx.appendingPathComponent("cert.der")), chain: [])
let profile = try Profile(try Data(contentsOf: fx.appendingPathComponent("profile.mobileprovision")))
let s = IPASigner(profile: profile, identity: id)
s.options.keepBundleID = a[4] == "keep"
s.log = { print($0) }
let app = try s.sign(URL(fileURLWithPath: a[2]), to: URL(fileURLWithPath: a[3]))
print("signed as \(app.bundleID) (was \(app.originalBundleID)), removed \(app.removed)")
