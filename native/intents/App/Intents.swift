// N8: iFizBox's App Intents, so Shortcuts, Siri, Spotlight and the Action button get them with nothing built by hand.
// Each is a thin wrapper around IntentsCore (../Core.swift, tested on Linux); the build turns these declarations into
// Cydian.app/Metadata.appintents (../metadata.py), which is how iOS finds them without Xcode.
//
//   both modes       Check for Updates (returns one line per update; dialog "3 Updates: …"), Add Source (URL; opens
//                    iFizBox's Add Source alert filled in), Restore My Packages (file; in the sideload app: its sources)
//   jailbreak only   Install All Updates, Respring, Userspace Reboot, Export My Packages (returns the file)
// The sideload IPA's metadata lists only the first three (metadata.py --mode sideload), so the jailbreak-only ones
// never show there; run anyway they say they need the jailbreak build. Respring and Userspace Reboot are also
// Control Center controls, from the widget extension (native/widget/).
// AppIntents is iOS 16+ and weak-linked (build.sh): on iOS 15 none of this is registered or run.
// Nothing here imports UIKit or WidgetKit: AppIntents with either in one file pulls in a cross-import overlay
// (_AppIntents_UIKit, _AppIntents_SwiftUI) that would be strongly linked and keep iFizBox from launching on iOS 15.
// SPDX-License-Identifier: GPL-3.0-or-later
import AppIntents
import Foundation

@available(iOS 16.0, *)
private func run<T>(_ f: @escaping () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { c in
        DispatchQueue.global(qos: .userInitiated).async {
            do { c.resume(returning: try f()) } catch { c.resume(throwing: error) }
        }
    }
}

@available(iOS 16.0, *)
extension IntentFailure: CustomLocalizedStringResourceConvertible {
    var localizedStringResource: LocalizedStringResource { LocalizedStringResource(stringLiteral: message) }
}

// F170: App Intents strings are read at build time (const values), so they name no product: no Brand.name here.
@available(iOS 16.0, *)
struct CheckForUpdatesIntent: AppIntent {
    static let title: LocalizedStringResource = "Check for Updates"
    static let description = IntentDescription("Refreshes your sources and returns the updates, one line each (name, installed version, new version). Use Count for the number.")

    func perform() async throws -> some IntentResult & ReturnsValue<[String]> & ProvidesDialog {
        let r = try await run { try IntentsCore.checkForUpdates(PhoneHost.shared) }
        WidgetStore.save(count: r.count, names: r.updates.map(\.name))
        return .result(value: r.lines, dialog: IntentDialog(stringLiteral: r.dialog))
    }
}

@available(iOS 16.0, *)
struct AddSourceIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Source"
    static let description = IntentDescription("Opens the Add Source alert with this URL filled in: an APT repo or an app source (.json).")
    static let openAppWhenRun = true

    @Parameter(title: "URL", description: "The repo's or the app source's address.")
    var url: URL

    @MainActor
    func perform() async throws -> some IntentResult {
        let link = try IntentsCore.addSourceLink(url)
        Incoming.receive(link) // the page's incoming.js opens Add Source (cydian://add, Sources/App.swift)
        return .result()
    }
}

@available(iOS 16.0, *)
struct InstallAllUpdatesIntent: AppIntent {
    static let title: LocalizedStringResource = "Install All Updates"
    static let description = IntentDescription("Refreshes your sources and installs every update, Ignored Upgrades left out. Jailbreak only.")

    func perform() async throws -> some IntentResult & ReturnsValue<[String]> & ProvidesDialog {
        let r = try await run { try IntentsCore.installAllUpdates(PhoneHost.shared) }
        WidgetStore.save(count: 0, names: [])
        return .result(value: r.installed.map { "\($0.name) \($0.version)" }, dialog: IntentDialog(stringLiteral: r.dialog))
    }
}

@available(iOS 16.0, *)
struct RespringIntent: AppIntent {
    static let title: LocalizedStringResource = "Respring"
    static let description = IntentDescription("Restarts SpringBoard. Jailbreak only.")

    func perform() async throws -> some IntentResult {
        try await run { try IntentsCore.respring(PhoneHost.shared) }
        return .result()
    }
}

@available(iOS 16.0, *)
struct UserspaceRebootIntent: AppIntent {
    static let title: LocalizedStringResource = "Userspace Reboot"
    static let description = IntentDescription("Restarts everything above the kernel (launchctl reboot userspace). Jailbreak only.")

    func perform() async throws -> some IntentResult {
        try await run { try IntentsCore.userspaceReboot(PhoneHost.shared) }
        return .result()
    }
}

@available(iOS 16.0, *)
struct ExportPackagesIntent: AppIntent {
    static let title: LocalizedStringResource = "Export My Packages"
    static let description = IntentDescription("Returns a file with your sources, the packages you installed and your Ignored Upgrades, for Restore My Packages. Jailbreak only.")

    func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
        let data = try await run { try IntentsCore.exportBackup(PhoneHost.shared) }
        return .result(value: IntentFile(data: data, filename: IntentsCore.backupFileName(), type: .json))
    }
}

@available(iOS 16.0, *)
struct RestorePackagesIntent: AppIntent {
    static let title: LocalizedStringResource = "Restore My Packages"
    static let description = IntentDescription("Adds the sources from an Export My Packages file and installs its packages again (after a re-jailbreak, or on a new iPhone). In the sideload app, adds the sources only.")
    // In the app's process with iFizBox open: a whole restore runs apt for minutes, longer than a background intent
    // may, and the sideload app hands the sources to the page.
    static let openAppWhenRun = true

    @Parameter(title: "File", description: "A file from Export My Packages.")
    var file: IntentFile

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let data = file.data
        let r = try await run { try IntentsCore.restore(data, PhoneHost.shared, gzip: gzipMember) }
        if let link = r.importLink.flatMap(URL.init(string:)) { Incoming.receive(link) } // Import's review alert
        return .result(dialog: IntentDialog(stringLiteral: r.dialog))
    }
}

// Siri phrases and Spotlight's App Shortcuts. The sideload IPA's metadata keeps only the both-modes ones.
@available(iOS 16.0, *)
struct CydianShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CheckForUpdatesIntent(),
                    phrases: ["Check for updates in \(.applicationName)", "Check \(.applicationName) for updates"],
                    shortTitle: "Check for Updates", systemImageName: "arrow.triangle.2.circlepath")
        AppShortcut(intent: InstallAllUpdatesIntent(),
                    phrases: ["Install all updates in \(.applicationName)", "Update everything in \(.applicationName)"],
                    shortTitle: "Install All Updates", systemImageName: "square.and.arrow.down")
        AppShortcut(intent: RespringIntent(), phrases: ["Respring with \(.applicationName)"],
                    shortTitle: "Respring", systemImageName: "arrow.clockwise")
        AppShortcut(intent: UserspaceRebootIntent(), phrases: ["Userspace reboot with \(.applicationName)"],
                    shortTitle: "Userspace Reboot", systemImageName: "power")
        AppShortcut(intent: ExportPackagesIntent(), phrases: ["Export my packages from \(.applicationName)"],
                    shortTitle: "Export My Packages", systemImageName: "square.and.arrow.up")
    }
}

// A gzip member (RFC 1952) over Zip.swift's raw deflate, for the sideload restore's cydian://import link.
func gzipMember(_ d: Data) throws -> Data {
    var out = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255])
    out.append(try deflateData(d))
    out.le32(crc32Of(d))
    out.le32(UInt32(truncatingIfNeeded: d.count))
    return out
}
