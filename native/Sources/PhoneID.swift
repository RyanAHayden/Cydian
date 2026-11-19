// F236: this iPhone, for "This iPhone is in the profile" (native/sign/DeviceCheck.swift). No configuration profile:
//   jailbreak build   `ifizbox-helper udid` (MobileGestalt's UniqueDeviceID, as root; Paid.udid in the app if it fails)
//   sideload build    the app's own embedded.mobileprovision: one device is this phone's UDID, several a set it is in
// Read once and kept: neither changes while the app runs.
//
//   device.udid   -> {udid | null, candidates: [udid], source: "helper" | "profile" | null}   (every build)
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

    static var source: String? {
        guard current() != nil else { return nil }
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
    }
}
