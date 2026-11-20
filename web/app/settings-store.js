// The one settings store the app uses (both modes and the site read it through here). In the jailbreak app the
// bridge's helper makes Ignored Upgrades real dpkg holds (F22); the bridge itself is N3's.
// Its own module so screens that only read or set a setting don't import the Settings screen (and its imports).
import { createSettings, detectMode } from "./core/settings.js";

export const settings = createSettings({ mode: detectMode(), helper: globalThis.ifizboxNative?.helper, native: globalThis.ifizboxNative });
