import { test } from "node:test";
import assert from "node:assert/strict";
import { midTruncate, isFileName, ELLIPSIS } from "./midtrunc.js";

// One unit per character: the width is how many characters fit.
const chars = (s) => [...s].length;
// Roughly Helvetica's: narrow i/l/1/., wide m/w, the rest in between.
const prop = (s) => [...s].reduce((w, c) => w + (/[il1.\-]/.test(c) ? 4 : /[mwMW]/.test(c) ? 13 : 9), 0);

test("a name that fits is unchanged", () => {
  assert.equal(midTruncate("App.ipa", 20, chars), "App.ipa");
  assert.equal(midTruncate("opentennis-beta-p146.ipa", 24, chars), "opentennis-beta-p146.ipa");
  assert.equal(midTruncate("", 10, chars), "");
});

test("a long name keeps its start and its extension, cut in the middle", () => {
  const s = midTruncate("opentennis-beta-p146.ipa", 18, chars);
  assert.equal(chars(s), 18);
  assert.ok(s.includes(ELLIPSIS));
  assert.ok(s.endsWith(".ipa"));
  assert.ok(s.startsWith("opentenni"));
  assert.ok(s.endsWith("p146.ipa"), s);
  assert.equal(s, "opentenni…p146.ipa");
});

test("the result fits the given width, at every width", () => {
  const name = "com.example.some-really-long-tweak_1.2.3-4_iphoneos-arm64.deb";
  for (const [measure, top] of [[chars, chars(name)], [prop, prop(name)]]) {
    for (let w = Math.ceil(top / 3); w < top; w += 3) {
      const s = midTruncate(name, w, measure);
      assert.ok(measure(s) <= w, `${s} at ${w}`);
      assert.ok(s.endsWith(".deb"), s);
      assert.ok(s.startsWith("c"), s);
      // and no room is wasted: within two of the widest character (one more on each side would not fit)
      assert.ok(measure(s) > w - 2 * 13, `${s} wastes room at ${w}`);
    }
  }
});

test("very narrow: the extension stays as long as anything can", () => {
  const s = midTruncate("opentennis-beta-p146.ipa", 6, chars);
  assert.ok(chars(s) <= 6);
  assert.ok(s.endsWith(".ipa"));
  assert.equal(midTruncate("opentennis-beta-p146.ipa", 1, chars), ELLIPSIS);
});

test("isFileName: .ipa and .deb only", () => {
  assert.ok(isFileName("opentennis-beta-p146.ipa"));
  assert.ok(isFileName("Tweak_1.0_iphoneos-arm64.DEB"));
  assert.ok(!isFileName("OpenTennis"));
  assert.ok(!isFileName("archive.zip"));
  assert.ok(!isFileName(null));
});
