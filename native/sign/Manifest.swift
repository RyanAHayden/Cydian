// The itms-services manifest for one IPA and the link that opens it (I6, docs/signing.md "Installing"). The sideload
// build serves the signed IPA over plain HTTP at 127.0.0.1 (InstallServer.plain) and the Signing Server hands iOS this
// manifest pointing at it (GET /sign/manifest): iOS opens manifests only over HTTPS with a certificate it trusts by
// itself, which a phone can't give its own loopback server (F75: a hand-trusted CA is ignored by the installer).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum InstallManifest {
    static func manifest(ipaURL: String, bundleID: String, version: String, title: String) throws -> Data {
        let item: [String: Any] = [
            "assets": [["kind": "software-package", "url": ipaURL]],
            "metadata": ["bundle-identifier": bundleID, "bundle-version": version.isEmpty ? "1.0" : version,
                         "kind": "software", "title": title.isEmpty ? bundleID : title],
        ]
        return try PropertyListSerialization.data(fromPropertyList: ["items": [item]], format: .xml, options: 0)
    }

    static func itmsURL(manifest: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return "itms-services://?action=download-manifest&url=" + (manifest.addingPercentEncoding(withAllowedCharacters: allowed) ?? manifest)
    }
}
