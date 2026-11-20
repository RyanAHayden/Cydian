// F236: this iPhone, for "This iPhone is in the profile" (native/sign/DeviceCheck.swift). No configuration profile:
//   jailbreak build   `ifizbox-helper udid` (MobileGestalt's UniqueDeviceID, as root; Paid.udid in the app if it fails)
//   sideload build    the app's own embedded.mobileprovision: one device is this phone's UDID, several a set it is in
// Read once and kept: neither changes while the app runs.
//
//   device.udid   -> {udid | null, candidates: [udid], source: "helper" | "profile" | null}   (every build)
//   device.udid.set {udid} -> as device.udid: the UDID the website's Profile Service visit found, kept as a paired one
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum PhoneID {
    private static let lock = NSLock()
    private static var known: DeviceCheck.Phone??

    static func current() -> DeviceCheck.Phone? {
        lock.lock(); defer { lock.unlock() }
        if let k = known { return k }
        let p = read()
        known = .some(p)
        return p
    }

    // The UDID lockdown gave through This iPhone's pairing (IDevice.readUDID): kept, and it wins over the profile's
    // guess in the sideload build.
    static let udidKey = "ifizbox.phone.udid"
    static func remember(_ udid: String) {
        let u = udid.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !u.isEmpty else { return }
        UserDefaults.standard.set(u, forKey: udidKey)
        lock.lock(); known = .some(.udid(u)); lock.unlock()
    }
    static var udid: String? { if case .udid(let u)? = current() { return u }; return nil }

    static var source: String? {
        guard current() != nil else { return nil }
        if AppMode.current != .jailbreak, UserDefaults.standard.string(forKey: udidKey) != nil { return "lockdown" }
        return AppMode.current == .jailbreak ? "helper" : "profile"
    }

    private static func read() -> DeviceCheck.Phone? {
        if AppMode.current == .jailbreak {
            guard let out = try? Helper.run(["udid"], emit: nil), out["code"] as? Int == 0,
                  let line = (out["stdout"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty,
                  !line.contains("\n") else {
                // The app asks MobileGestalt itself for paid packages (Paid.udid, its own entitlement): the fallback.
                NSLog("\(Brand.name): ifizbox-helper udid didn't answer")
                return Paid.udid().map { .udid($0) }
            }
            return .udid(line)
        }
        if let u = UserDefaults.standard.string(forKey: udidKey) { return .udid(u) }
        let embedded = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision").flatMap { try? Data(contentsOf: $0) }
        return DeviceCheck.phone(fromEmbedded: embedded)
    }

    // The signing profile against this phone.
    static func check(_ profile: Profile) -> DeviceCheck.Result { DeviceCheck.check(profile: profile.data, phone: current()) }

    static func json() -> [String: Any] {
        let p = current()
        var j: [String: Any] = ["udid": NSNull(), "candidates": [String](), "source": source ?? NSNull()]
        switch p {
        case .udid(let u)?: j["udid"] = u; j["candidates"] = [u]
        case .candidates(let c)?: j["candidates"] = c
        case nil: break
        }
        return j
    }

    static func register(_ b: Bridge) {
        b.on("device.udid") { c in
            DispatchQueue.global(qos: .userInitiated).async { Apt.reply(c, json(), nil) }
        }
        // F277: the UDID the website's Profile Service visit found (screens/devaccount.js findUdidViaSite), from iOS
        // itself, kept like a paired one. Only a UDID's shape is taken (25 or 40 hex characters with dashes).
        b.on("device.udid.set") { c in
            let u = (c.params["udid"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard u.range(of: "^[0-9A-Fa-f-]{25,40}$", options: .regularExpression) != nil else { return c.reply(nil, "bad_params: udid") }
            remember(u)
            c.reply(json(), nil)
        }
    }
}
