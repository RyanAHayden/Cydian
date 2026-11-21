// F236: this iPhone, for "This iPhone is in the profile" (native/sign/DeviceCheck.swift). No configuration profile:
//   jailbreak build   `ifizbox-helper udid` (MobileGestalt's UniqueDeviceID, as root; Paid.udid in the app if it fails)
//   sideload build    the app's own embedded.mobileprovision: one device is this phone's UDID, several a set it is in
// Read once and kept: neither changes while the app runs. A UDID lockdown or the website gave is kept in UserDefaults
// and the Keychain (B284), so a delete + reinstall still knows it.
//
//   device.udid   -> {udid | null, candidates: [udid], source: "helper" | "profile" | null}   (every build)
//   device.udid.set {udid} -> as device.udid: the UDID the website's Profile Service visit found, kept as a paired one
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Security

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
        keepUDID(u)
        lock.lock(); known = .some(.udid(u)); lock.unlock()
    }

    // B284: the paired UDID also goes in the Keychain (beside B276's signing items), as UserDefaults goes with the
    // container: after a delete + reinstall, This iPhone reads it back at launch without using the pairing first.
    // Not a secret; this device only, in iFizBox's own group.
    static let keepService = "com.ryha.ifizbox.phone", keepAccount = "udid"
    static var keepQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keepService,
         kSecAttrAccount as String: keepAccount]
    }
    static func keptUDID() -> String? {
        var q = keepQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data,
              let u = String(data: d, encoding: .utf8), !u.isEmpty else { return nil }
        return u
    }
    // A refusal is logged, never thrown: the UserDefaults copy still works until the next reinstall.
    static func keepUDID(_ u: String) {
        if keptUDID() == u { return }
        let data = Data(u.utf8)
        var st = SecItemUpdate(keepQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if st == errSecItemNotFound {
            var add = OwnKeychain.scoped(keepQuery)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            add[kSecAttrLabel as String] = "\(Brand.name) phone UDID"
            st = SecItemAdd(add as CFDictionary, nil)
        }
        if st != errSecSuccess { NSLog("\(Brand.name) keychain refused the phone UDID (\(st))") }
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
        // B284: a container that has it while the Keychain doesn't (paired before B284) puts it there; a fresh
        // container (deleted and reinstalled) gets it back from there.
        if let u = UserDefaults.standard.string(forKey: udidKey) { keepUDID(u); return .udid(u) }
        if let u = keptUDID() {
            UserDefaults.standard.set(u, forKey: udidKey)
            NSLog("\(Brand.name): phone UDID restored from the keychain")
            return .udid(u)
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
