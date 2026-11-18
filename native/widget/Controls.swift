// N8: Respring and Userspace Reboot as Control Center controls (iOS 18), jailbreak build only (-D CYDIAN_JAILBREAK:
// the sideload IPA's extension has no controls and no intents). The buttons' intents run here, in the extension: its
// jailbreak entitlements (entitlements.plist: platform-application, no sandbox, persona-mgmt, as the app's) let it
// spawn cydian-helper as root itself, through the same IntentsCore calls as the app's intents.
// SPDX-License-Identifier: GPL-3.0-or-later
#if CYDIAN_JAILBREAK
import AppIntents
import SwiftUI
import WidgetKit

extension IntentFailure: CustomLocalizedStringResourceConvertible {
    var localizedStringResource: LocalizedStringResource { LocalizedStringResource(stringLiteral: message) }
}

struct RespringIntent: AppIntent {
    static let title: LocalizedStringResource = "Respring"
    static let description = IntentDescription("Restarts SpringBoard.")

    func perform() async throws -> some IntentResult {
        try IntentsCore.respring(PhoneHost.shared)
        return .result()
    }
}

struct UserspaceRebootIntent: AppIntent {
    static let title: LocalizedStringResource = "Userspace Reboot"
    static let description = IntentDescription("Restarts everything above the kernel (launchctl reboot userspace).")

    func perform() async throws -> some IntentResult {
        try IntentsCore.userspaceReboot(PhoneHost.shared)
        return .result()
    }
}

@available(iOS 18.0, *)
struct RespringControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.ryha.cydian.respring") {
            ControlWidgetButton(action: RespringIntent()) { Label("Respring", systemImage: "arrow.clockwise") }
        }
        .displayName("Respring")
        .description("Restarts SpringBoard.")
    }
}

@available(iOS 18.0, *)
struct UserspaceRebootControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.ryha.cydian.userspace-reboot") {
            ControlWidgetButton(action: UserspaceRebootIntent()) { Label("Userspace Reboot", systemImage: "power") }
        }
        .displayName("Userspace Reboot")
        .description("Restarts everything above the kernel.")
    }
}

extension CydianWidgets {
    @WidgetBundleBuilder var controls: some Widget {
        if #available(iOS 18.0, *) {
            RespringControl()
            UserspaceRebootControl()
        }
    }
}
#endif
