// A source's name or description as plain text: emoji, pictographs and arrow symbols dropped, so a repo that puts
// "🧁" or "⬇️" in its Label or Description reads like every other row (iOS draws them as colour emoji, which no
// other row has).
//
//   plainText(s) -> s without emoji, pictographs, arrows, their joiners and variation selectors, spaces tidied;
//                   s itself when nothing but symbols is left (a name made only of emoji keeps them rather than
//                   going blank)
//
// What goes: Extended_Pictographic (emoji, ©, ®, ™ and the dingbats), the Arrows block and the arrows in
// Miscellaneous Symbols and Arrows (⬆ ⬇ ⬅ ➡ and friends), regional-indicator flags, skin-tone modifiers, keycap
// marks, zero-width joiners and the text/emoji variation selectors. Letters, digits and punctuation in any script
// stay.
const SYMBOLS = /[\p{Extended_Pictographic}←-⇿⟰-⟿⤀-⥿⬀-⯿\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}⃣‍︎️]/gu;

export function plainText(s) {
  if (typeof s !== "string") return s;
  if (!SYMBOLS.test(s)) return s;
  SYMBOLS.lastIndex = 0;
  const out = s.replace(SYMBOLS, " ").replace(/\s+/g, " ").trim();
  return out || s.trim();
}
