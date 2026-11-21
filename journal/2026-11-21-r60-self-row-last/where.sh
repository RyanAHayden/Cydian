#!/bin/sh
# where.sh "<exact text>" [n]: screenshot pixels (x y, 3x the page's points) of the centre of the n-th (default last)
# visible element whose own text is exactly that, for tools/ui-15.sh tap. Prints nothing when none is on screen.
S=$(dirname "$0")
CDP_PORT=${CDP_PORT:-9368} timeout 15 node "$S/ev.mjs" "(() => {
  const want = $(printf '%s' "$1" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))');
  const hits = [...document.querySelectorAll('body *')].filter((e) => {
    if (e.children.length && [...e.children].some((c) => c.innerText?.trim() === want)) return false;
    if (e.innerText?.trim() !== want) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  });
  const n = ${2:--1};
  const e = n < 0 ? hits[hits.length + n] : hits[n];
  if (!e) return '';
  const r = e.getBoundingClientRect();
  return Math.round((r.left + r.width / 2) * 3) + ' ' + Math.round((r.top + r.height / 2) * 3);
})()"
