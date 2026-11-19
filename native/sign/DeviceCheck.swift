// F236: is this iPhone in the signing profile? A development or ad hoc profile installs only on the devices it lists
// (ProvisionedDevices, by UDID); anywhere else iOS refuses the app with "integrity could not be verified". So the
// profile is checked against this phone, for Settings > Signing (signing.status's profile.device) and before signing,
// which then fails with a sentence that says what to do. web/app/core/signing.js deviceCheck is the same check, and
// its node test keeps the sentences here the same as its own.
//
// This phone (native/Sources/PhoneID.swift): the jailbreak build's UDID from the root helper (MobileGestalt), or the
// sideload build's own embedded.mobileprovision: one device there is this phone, several a set it is one of.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum DeviceCheck {
    enum Phone: Equatable {
        case udid(String)
        case candidates([String])
    }

    enum State: String { case inProfile = "in", out, unknown, skip }

    struct Result: Equatable {
        let state: State
        let udid: String?
        let count: Int     // the profile's devices
        let shared: Int    // how many of the phone's candidates it lists

        var json: [String: Any] {
            var j: [String: Any] = ["state": state.rawValue, "count": count, "shared": shared]
            if let u = udid { j["udid"] = u }
            return j
        }
    }

    static func normal(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }

    private static func unique(_ list: [String]) -> [String] {
        var seen = Set<String>(), out = [String]()
        for u in list.map(normal) where !u.isEmpty && seen.insert(u).inserted { out.append(u) }
        return out
    }

    // A profile's plist (from the bytes of a .mobileprovision): its device list, and whether it is for every device.
    static func devices(profile data: Data) -> (udids: [String], all: Bool) {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), options: .backwards, in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), format: nil) as? [String: Any]
        else { return ([], false) }
        let all = (plist["ProvisionsAllDevices"] as? Bool) ?? ((plist["ProvisionsAllDevices"] as? NSNumber)?.boolValue ?? false)
        return (unique((plist["ProvisionedDevices"] as? [Any] ?? []).compactMap { $0 as? String }), all)
    }

    // This phone, from the app's own embedded.mobileprovision: one device is its UDID, several a set, none unknown.
    static func phone(fromEmbedded data: Data?) -> Phone? {
        guard let d = data else { return nil }
        let list = devices(profile: d)
        if list.all { return nil }
        if list.udids.count == 1 { return .udid(list.udids[0]) }
        return list.udids.isEmpty ? nil : .candidates(list.udids)
    }

    static func check(udids profileUDIDs: [String], allDevices: Bool, phone: Phone?) -> Result {
        let udids = unique(profileUDIDs)
        let count = udids.count
        // Enterprise (every device) and a profile with no list (App Store distribution) aren't limited by device.
        if allDevices || count == 0 { return Result(state: .skip, udid: nil, count: count, shared: 0) }
        let has = Set(udids)
        switch phone {
        case .udid(let raw)?:
            // compared without case; shown as the phone gave it (the developer account takes it as written)
            let u = normal(raw), shown = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return Result(state: has.contains(u) ? .inProfile : .out, udid: shown, count: count, shared: has.contains(u) ? 1 : 0)
        case .candidates(let raw)?:
            let cands = unique(raw)
            if cands.isEmpty { return Result(state: .unknown, udid: nil, count: count, shared: 0) }
            let shared = cands.filter { has.contains($0) }.count
            // This phone is one of `cands`: a profile with all of them has it, one with none of them can't.
            if shared == cands.count { return Result(state: .inProfile, udid: cands.count == 1 ? cands[0] : nil, count: count, shared: shared) }
            return Result(state: shared == 0 ? .out : .unknown, udid: nil, count: count, shared: shared)
        case nil:
            return Result(state: .unknown, udid: nil, count: count, shared: 0)
        }
    }

    static func check(profile data: Data, phone: Phone?) -> Result {
        let d = devices(profile: data)
        return check(udids: d.udids, allDevices: d.all, phone: phone)
    }

    // ---- the sentences (the same as core/signing.js's)

    static let how = "To find the UDID, plug the iPhone into a Mac and click the line under its name in Finder, or run idevice_id -l on a computer it's plugged into."
    static let inText = "This iPhone is in the profile."

    static func notInText(_ udid: String?) -> String {
        if let udid = udid {
            return "This iPhone isn't in the profile: add its UDID \(udid) to the developer account, then make the profile again."
        }
        return "This iPhone isn't in the profile: add its UDID to the developer account, then make the profile again. \(how)"
    }

    // Why signing with this profile can't install on this phone (code device_not_in_profile), or nil: it can, or the
    // check couldn't run (then iOS has the last word, and the page names this as the likely cause if it doesn't land).
    static func problem(_ r: Result) -> SignError? {
        r.state == .out ? SignError("device_not_in_profile", notInText(r.udid)) : nil
    }
}
