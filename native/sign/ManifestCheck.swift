// B30: before the sideload build hands iOS an itms-services link, it GETs the exact manifest URL itself. iOS shows no
// Install prompt and no error at all when it can't load the manifest (a 404, a server down, DNS for a new domain, an
// old custom Signing Server), so the install sat on "Installing" for ever. Here: what counts as a manifest iOS can
// read, and the error the page shows when it isn't one. The fetch itself is Sideload.swift's (URLSession, iOS only).
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum ManifestCheck {
    static let timeout: TimeInterval = 10

    // The answer to GET <manifest URL>: nil when it is a manifest iOS can read (HTTP 200, a property list with an
    // `items` list), else why not, in words for the error. `error` is the transport's (no answer at all).
    static func problem(status: Int?, body: Data?, error: Error?) -> String? {
        if let e = error { return reason(e) }
        guard let status = status else { return "no answer" }
        let b = body ?? Data()
        guard status == 200 else {
            // The Worker's errors are JSON {code, error}: its words say more than the status.
            let json = (try? JSONSerialization.jsonObject(with: b)) as? [String: Any]
            if let why = json?["error"] as? String, !why.isEmpty { return "it answered HTTP \(status) (\(why))" }
            return "it answered HTTP \(status)"
        }
        guard let plist = try? PropertyListSerialization.propertyList(from: b, options: [], format: nil) as? [String: Any],
              let items = plist["items"] as? [Any], !items.isEmpty else {
            return "its answer isn't an install manifest"
        }
        return nil
    }

    // A transport error in short words: URLSession's own text, without a trailing full stop (the sentence goes on).
    static func reason(_ e: Error) -> String {
        var s = ((e as? LocalizedError)?.errorDescription ?? (e as NSError).localizedDescription)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix(".") { s.removeLast() }
        return s.isEmpty ? "no answer" : s
    }

    // The error for the page ("no_manifest: ..." -> core/signing.js deviceError). `reached`: the server answered
    // (with the wrong thing), so it isn't "couldn't reach".
    static func errorText(host: String, reason: String, reached: Bool) -> String {
        let what = reached ? "\(host) didn't give the install manifest: \(reason)" : "Couldn't reach \(host): \(reason)"
        return "no_manifest: \(what). iOS can't show Install without it."
    }

    // The install log's line for a check that passed.
    static func okLine(host: String) -> String { "Checked the manifest: \(host) answers it, so iOS can show Install" }

    static func host(of url: URL) -> String { url.host ?? url.absoluteString }
}
