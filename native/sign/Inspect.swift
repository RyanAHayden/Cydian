// What an IPA is and asks for, read before it's signed (F14), so the user can see it and change the name, bundle ID
// and icon, or leave extensions out (SideStore #780, #218; TrollStore #662; AltStore #1625): the app's entitlements
// (from its current signature), its privacy permissions (Info.plist's usage descriptions), its extensions, and
// which of its entitlements the user's profile can't give it. Also the profile's kind.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

struct AppDetails {
    struct Extension {
        let path: String          // under the app: "PlugIns/Share.appex"
        let bundleID: String
        let name: String
        let point: String         // NSExtensionPointIdentifier, or "watch" for a Watch app
    }
    struct Permission {
        let key: String           // NSCameraUsageDescription
        let label: String         // Camera
        let text: String          // the app's own reason
    }
    let name: String
    let bundleID: String
    let version: String
    let minimumOS: String
    let executable: String
    let entitlements: [String: Any]    // the main executable's, from its current signature ([:] when unsigned)
    let permissions: [Permission]
    let extensions: [Extension]
    let iconPath: String?              // the largest loose icon PNG in the app, if any (may be Apple's CgBI PNG)
    let size: UInt64                   // unpacked bytes

    var json: [String: Any] {
        ["name": name, "bundleId": bundleID, "version": version, "minimumOS": minimumOS, "size": size,
         "entitlements": entitlements,
         "permissions": permissions.map { ["key": $0.key, "label": $0.label, "text": $0.text] },
         "extensions": extensions.map { ["path": $0.path, "bundleId": $0.bundleID, "name": $0.name, "point": $0.point] }]
    }

    // Entitlements the app has that the profile can't give it: iOS refuses to launch an app whose signature claims
    // an entitlement its profile lacks, so the signer only signs the profile's; these are what the app loses.
    func missing(from profile: Profile) -> [String] {
        let skip: Set<String> = ["application-identifier", "com.apple.developer.team-identifier", "get-task-allow",
                                 "keychain-access-groups", "beta-reports-active"]
        return entitlements.keys.filter { !skip.contains($0) && profile.entitlements[$0] == nil }.sorted()
    }

    // Info.plist keys for the permissions iOS asks the user about, with the names Settings > Privacy uses.
    static let permissionNames: [(String, String)] = [
        ("NSCameraUsageDescription", "Camera"), ("NSMicrophoneUsageDescription", "Microphone"),
        ("NSPhotoLibraryUsageDescription", "Photos"), ("NSPhotoLibraryAddUsageDescription", "Photos (Add Only)"),
        ("NSLocationWhenInUseUsageDescription", "Location While Using"),
        ("NSLocationAlwaysAndWhenInUseUsageDescription", "Location Always"), ("NSLocationAlwaysUsageDescription", "Location Always"),
        ("NSContactsUsageDescription", "Contacts"), ("NSCalendarsUsageDescription", "Calendars"),
        ("NSCalendarsFullAccessUsageDescription", "Calendars"), ("NSRemindersUsageDescription", "Reminders"),
        ("NSRemindersFullAccessUsageDescription", "Reminders"),
        ("NSBluetoothAlwaysUsageDescription", "Bluetooth"), ("NSBluetoothPeripheralUsageDescription", "Bluetooth"),
        ("NSLocalNetworkUsageDescription", "Local Network"), ("NSMotionUsageDescription", "Motion & Fitness"),
        ("NSHealthShareUsageDescription", "Health (Read)"), ("NSHealthUpdateUsageDescription", "Health (Write)"),
        ("NSHomeKitUsageDescription", "Home"), ("NSAppleMusicUsageDescription", "Media & Apple Music"),
        ("NSSpeechRecognitionUsageDescription", "Speech Recognition"), ("NSFaceIDUsageDescription", "Face ID"),
        ("NSUserTrackingUsageDescription", "Tracking"), ("NSSiriUsageDescription", "Siri"),
        ("NFCReaderUsageDescription", "NFC"), ("NSFocusStatusUsageDescription", "Focus"),
    ]
}

enum Inspect {
    static func ipa(_ url: URL) throws -> AppDetails {
        let zip = try ZipReader(url: url)
        let infos = zip.entries.filter {
            let p = $0.name.split(separator: "/", omittingEmptySubsequences: false)
            return p.count == 3 && p[0] == "Payload" && p[1].hasSuffix(".app") && p[2] == "Info.plist"
        }
        guard infos.count == 1 else {
            throw SignError("bad_ipa", infos.isEmpty ? "That isn't an IPA (no Payload/<App>.app/Info.plist)." : "The IPA holds more than one app.")
        }
        let appDir = String(infos[0].name.dropLast("Info.plist".count))
        func plist(_ e: ZipEntry) -> [String: Any]? {
            (try? zip.data(e, limit: 16 << 20)).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: Any] }
        }
        guard let pl = plist(infos[0]), let id = pl["CFBundleIdentifier"] as? String else {
            throw SignError("bad_ipa", "The app's Info.plist can't be read.")
        }
        let exe = pl["CFBundleExecutable"] as? String ?? ""
        var ents = [String: Any]()
        if !exe.isEmpty, let e = zip.entries.first(where: { $0.name == appDir + exe }), let bin = try? zip.data(e) {
            ents = entitlements(bin) ?? [:]
        }
        var perms = [AppDetails.Permission]()
        for (k, label) in AppDetails.permissionNames {
            if let t = pl[k] as? String { perms.append(.init(key: k, label: label, text: t)) }
        }
        // Extensions and Watch apps: an Info.plist one level into PlugIns/, Extensions/ or Watch/.
        var exts = [AppDetails.Extension]()
        for e in zip.entries where e.name.hasPrefix(appDir) && e.name.hasSuffix("/Info.plist") {
            let rel = e.name.dropFirst(appDir.count).split(separator: "/").map(String.init)
            guard rel.count == 3, ["PlugIns", "Extensions", "Watch"].contains(rel[0]),
                  rel[1].hasSuffix(".appex") || rel[1].hasSuffix(".app"), let p = plist(e) else { continue }
            let point = rel[1].hasSuffix(".app") ? "watch"
                : ((p["NSExtension"] as? [String: Any])?["NSExtensionPointIdentifier"] as? String ?? "")
            exts.append(.init(path: rel[0] + "/" + rel[1], bundleID: p["CFBundleIdentifier"] as? String ?? "",
                              name: p["CFBundleDisplayName"] as? String ?? p["CFBundleName"] as? String ?? String(rel[1].split(separator: ".")[0]),
                              point: point))
        }
        return AppDetails(
            name: pl["CFBundleDisplayName"] as? String ?? pl["CFBundleName"] as? String ?? exe,
            bundleID: id,
            version: pl["CFBundleShortVersionString"] as? String ?? pl["CFBundleVersion"] as? String ?? "",
            minimumOS: pl["MinimumOSVersion"] as? String ?? "",
            executable: exe, entitlements: ents, permissions: perms,
            extensions: exts.sorted { $0.path < $1.path },
            iconPath: icon(pl, appDir: appDir, names: Set(zip.entries.map(\.name))),
            size: zip.entries.reduce(0) { $0 + $1.size })
    }

    // The app's icon PNG: the names Info.plist lists (CFBundleIcons...CFBundleIconFiles, CFBundleIconFiles), with
    // @3x, @2x and ~iphone tried, the biggest scale first.
    static func icon(_ pl: [String: Any], appDir: String, names: Set<String>) -> String? {
        var stems = [String]()
        for key in ["CFBundleIcons", "CFBundleIcons~ipad"] {
            if let primary = (pl[key] as? [String: Any])?["CFBundlePrimaryIcon"] as? [String: Any] {
                stems += primary["CFBundleIconFiles"] as? [String] ?? []
                if let n = primary["CFBundleIconName"] as? String { stems.append(n) }
            }
        }
        stems += pl["CFBundleIconFiles"] as? [String] ?? []
        if let f = pl["CFBundleIconFile"] as? String { stems.append(f) }
        stems.append("AppIcon60x60")
        for stem in stems {
            let base = stem.hasSuffix(".png") ? String(stem.dropLast(4)) : stem
            for suffix in ["@3x.png", "@2x.png", "@3x~iphone.png", "@2x~iphone.png", ".png"] where names.contains(appDir + base + suffix) {
                return appDir + base + suffix
            }
        }
        return nil
    }

    // A Mach-O's entitlements from its signature's XML slot (5), the first slice of a fat file; nil when unsigned.
    static func entitlements(_ file: Data) -> [String: Any]? {
        var d = file
        if d.count >= 8, d.be32(at: 0) == MachO.fatMagic {
            let n = Int(d.be32(at: 4))
            var found: Data?
            for i in 0..<n where 8 + i * 20 + 20 <= d.count {
                let off = Int(d.be32(at: 8 + i * 20 + 8)), size = Int(d.be32(at: 8 + i * 20 + 12))
                if d.be32(at: 8 + i * 20) & 0x0100_0000 != 0, off + size <= d.count {
                    found = d.subdata(in: d.startIndex + off..<d.startIndex + off + size); break
                }
            }
            guard let f = found else { return nil }
            d = f
        }
        guard d.count >= 32, d.le32(at: 0) == MachO.magic64 else { return nil }
        let ncmds = Int(d.le32(at: 16))
        var off = 32
        for _ in 0..<ncmds {
            guard off + 8 <= d.count else { return nil }
            let cmd = d.le32(at: off), size = Int(d.le32(at: off + 4))
            if cmd == 0x1D, off + 16 <= d.count { // LC_CODE_SIGNATURE
                let so = Int(d.le32(at: off + 8)), ss = Int(d.le32(at: off + 12))
                guard so + ss <= d.count, ss >= 12, d.be32(at: so) == 0xFADE0CC0 else { return nil }
                let count = Int(d.be32(at: so + 8))
                for i in 0..<count where so + 12 + 8 * i + 8 <= d.count {
                    let type = d.be32(at: so + 12 + 8 * i), bo = Int(d.be32(at: so + 16 + 8 * i))
                    guard type == 5, so + bo + 8 <= d.count, d.be32(at: so + bo) == 0xFADE7171 else { continue }
                    let len = Int(d.be32(at: so + bo + 4))
                    guard len >= 8, so + bo + len <= d.count else { return nil }
                    let xml = d.subdata(in: d.startIndex + so + bo + 8..<d.startIndex + so + bo + len)
                    return try? PropertyListSerialization.propertyList(from: xml, format: nil) as? [String: Any]
                }
                return nil
            }
            guard size > 0 else { return nil }
            off += size
        }
        return nil
    }
}

extension Profile {
    // As the site's profileKind (web/app/core/signing.js): Enterprise (all devices), Development (get-task-allow),
    // Ad Hoc (a device list), else Distribution (App Store: it installs on no device, so it can't sideload).
    enum Kind: String { case enterprise = "Enterprise", development = "Development", adHoc = "Ad Hoc", distribution = "Distribution" }

    var kind: Kind {
        if devices == -1 { return .enterprise }
        if entitlements["get-task-allow"].flatMap(plistBool) == true { return .development }
        return devices > 0 ? .adHoc : .distribution
    }

    // The latest moment apps signed with this profile and certificate still open: the earlier of the two expiries.
    func signatureExpiry(certificate: Data) -> Date? {
        let c = (try? Certificate(der: certificate))?.notAfter
        switch (expires, c) {
        case let (a?, b?): return min(a, b)
        case let (a?, nil): return a
        case let (nil, b?): return b
        default: return nil
        }
    }
}
