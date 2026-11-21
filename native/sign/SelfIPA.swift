// F329a: an IPA of the running app, made from its own bundle on the phone, for the Lite app's re-sign of itself (your
// own icon: AppIcon.swift OwnIcons.selfSource). No copy of the installed IPA is kept, and none is needed: the bundle
// is the app as installed. Its old signature and profile go in as they are; IPASigner drops and makes them again.
// Every file is stored, not deflated: the signer reads it once and the IPA is gone after.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum SelfIPA {
    // The record's url for an app signed from its own bundle (Sideload.swift resign makes the IPA again from it).
    static let url = "self:bundle"

    // `app` (a .app folder) zipped as Payload/<name>.app/ into `output`. Symlinks go in as symlinks, file modes kept.
    static func make(app: URL, to output: URL, stop: () -> Bool = { false }) throws {
        let fm = FileManager.default
        let root = app.standardizedFileURL.resolvingSymlinksInPath()
        guard root.pathExtension == "app", fm.fileExists(atPath: root.appendingPathComponent("Info.plist").path) else {
            throw SignError("bad_app", "\(root.lastPathComponent) isn't an app bundle.")
        }
        let base = "Payload/\(root.lastPathComponent)/"
        let zip = try ZipWriter(url: output)
        var closed = false
        defer { if !closed { zip.close() } }
        try zip.add("Payload/", Data(), mode: 0o040755)
        try zip.add(base, Data(), mode: 0o040755)
        guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: nil, options: []) else {
            throw SignError("bad_app", "\(root.lastPathComponent) can't be read.")
        }
        var paths = [String]()
        for case let u as URL in walk {
            let rel = String(u.standardizedFileURL.path.dropFirst(root.path.count + 1))
            if !rel.isEmpty { paths.append(rel) }
        }
        for rel in paths.sorted() {
            if stop() { throw SignError("cancelled", "Cancelled") }
            let path = root.appendingPathComponent(rel).path
            let a = try fm.attributesOfItem(atPath: path)
            let perm = UInt32((a[.posixPermissions] as? NSNumber)?.intValue ?? 0o644) & 0o7777
            switch a[.type] as? FileAttributeType {
            case .typeDirectory?:
                try zip.add(base + rel + "/", Data(), mode: 0o040000 | perm)
            case .typeSymbolicLink?:
                let target = try fm.destinationOfSymbolicLink(atPath: path)
                try zip.add(base + rel, Data(target.utf8), mode: 0o120000 | 0o755, level: 0)
            case .typeRegular?:
                try autoreleasepool {
                    let d = try Data(contentsOf: URL(fileURLWithPath: path), options: .alwaysMapped)
                    try zip.add(base + rel, d, mode: 0o100000 | perm, level: 0)
                }
            default:
                continue // sockets, devices: nothing an app holds
            }
        }
        zip.close()
        closed = true
    }
}
