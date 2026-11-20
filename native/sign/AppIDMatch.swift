// An update or re-sign of an app that is on the phone must carry the application-identifier it was installed with:
// installd refuses anything else (MismatchedApplicationIdentifierEntitlement, error 15), and the only way past that is
// deleting the app, which loses its data. This picks, from the profiles iFizBox can sign with, one that can give the
// installed application-identifier, and words the stop when none can.
// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation

enum AppIDMatch {
    // The App ID (without the team) `profile` signs with to give `installed` ("TEAM.com.you.app", or a wildcard
    // copied as it was: "TEAM.com.you.*"), or nil when it can't: another team, an explicit profile for another ID,
    // or a wildcard whose prefix doesn't cover it.
    static func entitlementsID(_ profile: Profile, installed: String) -> String? {
        guard !profile.team.isEmpty, installed.hasPrefix(profile.team + ".") else { return nil }
        let rest = String(installed.dropFirst(profile.team.count + 1))
        guard !rest.isEmpty else { return nil }
        if rest == profile.appID { return rest } // explicit, or the wildcard itself as an earlier signer wrote it
        if profile.appID == "*" { return rest }
        if profile.appID.hasSuffix(".*"), rest.hasPrefix(String(profile.appID.dropLast())) { return rest }
        return nil
    }

    // The first of `profiles` (in the order they are preferred) that can give `installed`, with its App ID.
    static func pick(_ profiles: [Profile], installed: String) -> (profile: Profile, entitlementsID: String)? {
        for p in profiles { if let id = entitlementsID(p, installed: installed) { return (p, id) } }
        return nil
    }

    // The words when no profile fits: what iOS has, what the profile would give, and the two ways on.
    static func mismatch(name: String, installed: String, profile: Profile, wouldBe: String) -> SignError {
        let app = name.isEmpty ? "This app" : name
        return SignError("appid_mismatch",
                         "\(app) is installed under App ID \(installed), and your provisioning profile signs it as \(wouldBe). "
                         + "iOS only updates an app signed for the App ID it was installed with. Import the profile it was "
                         + "installed with (\(installed)) and try again, or delete \(name.isEmpty ? "the app" : name) from the "
                         + "Home Screen and install it again (its data is lost).")
    }

    // installd's raw answer for that refusal. idevice has no type for it, so it comes as its UnknownErrorType (code 15,
    // which every unnamed installd error shares): "unknown error `MismatchedApplicationIdentifierEntitlement (...)`
    // returned from device (15)". Only the name tells it apart.
    static func isMismatch(_ text: String) -> Bool { text.contains("MismatchedApplicationIdentifierEntitlement") }

    // The plain words for it, in place of installd's.
    static func installdText(name: String) -> String {
        let app = name.isEmpty ? "the app" : name
        return "iOS refused the update: \(app) on this iPhone was signed for another App ID than this copy. "
            + "Import the profile it was installed with and try again, or delete \(app) from the Home Screen and install "
            + "it again (its data is lost)."
    }
}
