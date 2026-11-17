// The service worker for "Check on This Device" (F34), registered with { type: "module" } by push-client.js in
// place of sw.js when the user picks that mode. It is sw.js (imported for its install, push and
// notificationclick handlers) plus the on-device check: a `{ type: "check" }` push runs device-check.js here.
// A browser without module service workers rejects the registration, and push-client.js stays on sw.js and the
// server-side check.
import "./sw.js";
import { deviceCheck, swEnv } from "./device-check.js";

self.cydianDeviceCheck = (msg) => deviceCheck(msg, swEnv(self));
