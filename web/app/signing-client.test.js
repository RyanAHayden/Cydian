// F47: signing-client.js's poll of an asynchronous signing job (GET /sign/job/<id>).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pollJob } from "./signing-client.js";

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function serve(answers) {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a;
  };
  return urls;
}
const now = { wait: async () => {} };

test("polls through the phases to the link", async () => {
  const urls = serve([reply(200, { status: "downloading" }), reply(200, { status: "signing" }),
    reply(200, { status: "done", itms: "itms-services://x" })]);
  const r = await pollJob("https://s.example", { job: "a/b", poll: 1 }, now);
  assert.deepEqual(r, { status: 200, body: { status: "done", itms: "itms-services://x" } });
  assert.equal(urls.length, 3);
  assert.equal(urls[0], "https://s.example/sign/job/a%2Fb");
});

test("a failed job answers with its own HTTP status and message", async () => {
  serve([reply(200, { status: "error", error: "too big", code: "too_large", httpStatus: 413 })]);
  const r = await pollJob("https://s.example", { job: "j" }, now);
  assert.equal(r.status, 413);
  assert.equal(r.body.error, "too big");
});

test("a gone job (server restart) ends the poll", async () => {
  serve([reply(404, { error: "unknown", code: "gone" })]);
  assert.equal((await pollJob("https://s.example", { job: "j" }, now)).status, 404);
});

test("rides out a few network errors and proxy hiccups, then gives up", async () => {
  serve([new TypeError("offline"), reply(502, null), reply(200, { status: "signing" }),
    reply(200, { status: "done", itms: "i" })]);
  assert.equal((await pollJob("https://s.example", { job: "j" }, now)).status, 200);
  serve(Array.from({ length: 5 }, () => new TypeError("offline")));
  await assert.rejects(pollJob("https://s.example", { job: "j" }, now), TypeError);
});

test("waits the server's poll hint, kept between 0.5 and 5 s", async () => {
  for (const [poll, ms] of [[1, 1000], [0, 1000], [0.1, 500], [60, 5000]]) {
    serve([reply(200, { status: "done", itms: "i" })]);
    const waits = [];
    await pollJob("https://s.example", { job: "j", poll }, { wait: async (t) => { waits.push(t); } });
    assert.deepEqual(waits, [ms]);
  }
});
