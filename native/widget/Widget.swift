// N8: iFizBox's widget extension (iFizBox.app/PlugIns/iFizBoxWidget.appex, iOS 17+): a Home Screen and Lock Screen widget
// with the update count, and in the jailbreak build Respring and Userspace Reboot as Control Center controls (iOS 18,
// Controls.swift, built with -D IFIZBOX_JAILBREAK; also what the Action button can run).
// The count comes from the App Group's defaults, which the app writes (native/intents/App/WidgetStore.swift: Check for
// Updates, Install All Updates and every count the page shows in Changes); in the jailbreak build also from N5's
// daemon's state file (its daily apt check), whichever is newer. Without the App Group and before any check it says
// "Open iFizBox".
// SPDX-License-Identifier: GPL-3.0-or-later
import SwiftUI
import WidgetKit

struct UpdatesEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetShare.Snapshot?
}

struct UpdatesProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpdatesEntry {
        UpdatesEntry(date: Date(), snapshot: WidgetShare.Snapshot(count: 3, names: [], checked: Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (UpdatesEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : UpdatesEntry(date: Date(), snapshot: current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpdatesEntry>) -> Void) {
        // The app reloads it when the count changes; the hourly look picks up the daemon's daily check.
        completion(Timeline(entries: [UpdatesEntry(date: Date(), snapshot: current())], policy: .after(Date(timeIntervalSinceNow: 3600))))
    }

    func current() -> WidgetShare.Snapshot? {
        let shared = WidgetShare.decode(UserDefaults(suiteName: WidgetShare.group)?.object(forKey: WidgetShare.key))
        #if IFIZBOX_JAILBREAK
        let daemon = PhoneHost.shared.read("/var/lib/ifizbox/upgrades.state").flatMap(WidgetShare.daemonState)
        return WidgetShare.pick(shared, daemon)
        #else
        return shared
        #endif
    }
}

struct UpdatesView: View {
    @Environment(\.widgetFamily) var family
    let entry: UpdatesEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(WidgetShare.label(entry.snapshot))
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(entry.snapshot.map { "\($0.count)" } ?? "–").font(.system(size: 22, weight: .semibold))
                    Text("Updates").font(.system(size: 9))
                }
            }
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(Brand.name).font(.system(size: 13, weight: .semibold)).foregroundColor(.secondary)
                Spacer(minLength: 0)
                if let s = entry.snapshot {
                    Text("\(s.count)").font(.system(size: 44, weight: .bold)).minimumScaleFactor(0.5)
                    Text(s.count == 1 ? "Update" : "Updates").font(.system(size: 15, weight: .semibold))
                    Text(s.checked, style: .relative).font(.system(size: 11)).foregroundColor(.secondary)
                } else {
                    Text("Open \(Brand.name)").font(.system(size: 17, weight: .semibold))
                    Text("to check for updates").font(.system(size: 12)).foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

struct UpdatesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetShare.kind, provider: UpdatesProvider()) { entry in
            UpdatesView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Updates")
        .description("How many updates \(Brand.name) has found.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryInline])
    }
}

@main
struct iFizBoxWidgets: WidgetBundle {
    var body: some Widget {
        UpdatesWidget()
        #if IFIZBOX_JAILBREAK
        controls
        #endif
    }
}
