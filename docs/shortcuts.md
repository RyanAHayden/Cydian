# Shortcuts, Siri, Spotlight, widget and controls

iFizBox's app brings its own actions (`native/intents/README.md`): nothing to build by hand. They show in the
Shortcuts app under iFizBox, in Spotlight, and for Siri. The sideload app has the first three; the jailbreak app all.

| action | sideload app | jailbreak app |
|---|---|---|
| Check for Updates | apps you installed with iFizBox | apt packages (refreshes sources first) |
| Add Source (URL) | yes | yes |
| Restore My Packages (file) | adds the file's sources | sources, packages and Ignored Upgrades |
| Install All Updates | – | yes |
| Respring | – | yes, also a Control Center control |
| Userspace Reboot | – | yes, also a Control Center control |
| Export My Packages | – | yes |

Check for Updates returns one line per update (`Name 1.0 → 1.1`); use **Count** for the number. Install All Updates
returns the packages it installed.

## Recipes

- **Daily update notice.** Automation → Time of Day → Run Immediately. Actions: Check for Updates; Count (Items);
  If Count is greater than 0: Show Notification "iFizBox: (Count) updates".
- **Update everything at night (jailbreak).** Automation → Time of Day, 03:00, When Charging → Run Immediately.
  Install All Updates; then Respring if the dialog asked for it (or leave that to Settings > Automatic Updates).
- **Action button.** Settings → Action Button → Controls (Respring, Userspace Reboot) or Shortcut (any action above).
- **Add a repo from a link.** Share sheet shortcut (accepts URLs): Add Source with Shortcut Input. iFizBox opens its Add
  Source alert filled in; you still tap Add Source. (iFizBox is also in the share sheet itself: `native/share/README.md`.)
- **Back up before a re-jailbreak.** Export My Packages; Save File to iCloud Drive. After the re-jailbreak (or on a new
  phone): Get File; Restore My Packages. Packages no source has any more are listed, not installed.

## Widget

Home Screen (small) and Lock Screen (circular, inline): the update count, from iFizBox's last check. Jailbreak: also
the daily background check (the `ifizbox-upgrades` daemon), whichever is newer. It needs the App Group `group.com.ryha.ifizbox`; a
sideload signer whose profile has none leaves it at "Open iFizBox".
