// N8: the Add Source intent hands the page ifizbox://add?url=… (native/intents/Core.swift addSourceLink); incoming.js
// opens Add Source's alert filled in, a dist repo with its suite and components, and ignores a link without a URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addPrefill, handleIncoming } from "./incoming.js";

const deps = (calls) => ({ hud: (t) => () => t, add: async (ctx, prefill) => { calls.push({ ctx, prefill }); } });

test("ifizbox://add opens Add Source with the URL", async () => {
  const calls = [];
  assert.equal(await handleIncoming("ifizbox://add?url=https://repo.example.com/", deps(calls)), "add");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].prefill, { url: "https://repo.example.com/" });
  assert.equal(typeof calls[0].ctx.showHUD, "function");
});

test("ifizbox://add with a suite and components (the intent's encoding of & = +)", async () => {
  const calls = [];
  await handleIncoming("ifizbox://add?url=https://apt.procurs.us/&suite=1800&component=main", deps(calls));
  assert.deepEqual(calls[0].prefill, { url: "https://apt.procurs.us/", dist: "1800", components: ["main"] });
  assert.deepEqual(addPrefill("ifizbox://add?url=https://r.example/a?b%3Dc%26d%3De%2Bf"), { url: "https://r.example/a?b=c&d=e+f" });
});

test("ifizbox://add without an http(s) URL does nothing", async () => {
  const calls = [];
  assert.equal(await handleIncoming("ifizbox://add?url=file:///etc/passwd", deps(calls)), "add");
  assert.equal(await handleIncoming("ifizbox://add", deps(calls)), "add");
  assert.equal(calls.length, 0);
  assert.equal(addPrefill("not a url"), null);
});
