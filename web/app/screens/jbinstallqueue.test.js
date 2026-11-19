// F255: in the jailbreak app, a not-installed app page's Install queues the app in the app queue (app-queue.js) and
// Confirm opens, as a row's Install and Changes' Upgrade (N) do, instead of installing at once; an app with no IPA the
// helper can install keeps the first row's one tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppQueue } from "../core/appqueue.js";
import { jbModifyQueue } from "./browse.js";

const pkg = { key: "alt:https://s/", row: { id: "com.x.a", name: "A" }, stanza: { kind: "ipa", ipa: { bundleIdentifier: "com.x.a", name: "A",
  sourceUrl: "https://s/", versions: [{ version: "2.0", downloadURL: "https://s/a2.ipa" }] } } };
const none = async () => ({ all: async () => [] });

test("Install of an app that isn't installed: an install job in the app queue, queued loud so Confirm opens", async () => {
  const q = createAppQueue();
  const events = [];
  q.subscribe((e) => events.push(e));
  await jbModifyQueue(pkg, null, { queue: q, store: none }).install({ version: "2.0" });
  const j = q.get("com.x.a");
  assert.deepEqual([j.op, j.mode, j.installed, j.version, j.url], ["install", "install", null, "2.0", "https://s/a2.ipa"]);
  assert.deepEqual(events.map((e) => [e.type, !!e.quiet]), [["add", false]]);
});

test("browse.js packageActions queues a not-installed app before the one-tap install row, only with an IPA to queue", () => {
  const src = readFileSync(new URL("./browse.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function packageActions("));
  const queued = body.indexOf("return jbq.install(v);");
  assert.ok(queued > 0, "Install queues through jbModifyQueue");
  assert.ok(body.indexOf("jailbreakModify(") < queued, "after Modify's sheet (installed apps)");
  assert.ok(queued < body.indexOf("rows[0].onClick();"), "before Install's one tap");
  assert.match(body.slice(body.lastIndexOf("\n", queued), queued), /jbq && appJob\(pkg/);
});
