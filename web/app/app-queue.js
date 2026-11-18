// The sideload app's (and the website's) one install queue for apps (F80), shared by the app pages (altstore.js),
// Changes' Upgrade (N) and the Confirm sheet (screens/queue.js). The model is core/appqueue.js; the jailbreak build's
// apt queue is queue.js.
// SPDX-License-Identifier: GPL-3.0-or-later
import { createAppQueue } from "./core/appqueue.js";

export const appQueue = createAppQueue();
