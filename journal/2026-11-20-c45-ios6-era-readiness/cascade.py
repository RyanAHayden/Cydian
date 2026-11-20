#!/usr/bin/env python3
"""C45: prove that moving ios6.css's layout to style.css, and its decorations and geometry onto tokens, keeps the
cascade (after C46's cascade.py, extended to two sheets, at-rules and tokens the old sheets already had).

style.css loads right before ios6.css (index.html), so the two read as one sheet. Look and layout properties
(ios6-css.test.js LOOK) are disjoint and no shorthand spans both, so the old and new pair cascade the same when, after
every token that only the new pair defines on :root is put back in place of its var(), the sequence of look
declarations (at-rule context, selector, property, value, in source order) is the same and so is the sequence of
layout declarations. @keyframes bodies count as layout (motion).

Usage: cascade.py <old style.css> <old ios6.css> <new style.css> <new ios6.css>   Exit 0 when both match."""
import re
import sys

LOOK = re.compile(r"^(--.+|color|color-scheme|accent-color|caret-color|opacity|filter|-webkit-backdrop-filter|backdrop-filter|box-shadow|text-shadow|content|background(-[a-z]+)*|border(-[a-z]+)*|outline(-[a-z]+)*|-webkit-mask(-[a-z]+)*|mask(-[a-z]+)*|font(-[a-z]+)*|line-height|letter-spacing|word-spacing|text-align|text-transform|text-decoration(-[a-z]+)*|-webkit-font-smoothing|-webkit-text-stroke(-[a-z]+)*|fill|stroke(-[a-z]+)*|list-style(-[a-z]+)*)$")


def split(body):
    out, cur, depth, quote = [], "", 0, ""
    for ch in body:
        if quote:
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == ";" and depth == 0:
            out.append(cur)
            cur = ""
            continue
        cur += ch
    out.append(cur)
    return [d.strip() for d in out if d.strip()]


def blocks(src, ctx=""):
    """(context, selector, body) for every innermost rule; at-rules nest."""
    i = 0
    while True:
        b = src.find("{", i)
        if b < 0:
            return
        sel = re.sub(r"\s+", " ", src[i:b]).strip()
        depth, e, quote = 1, b + 1, ""
        while depth:
            ch = src[e]
            if quote:
                if ch == quote:
                    quote = ""
            elif ch in "\"'":
                quote = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            e += 1
        body = src[b + 1 : e - 1]
        if sel.startswith("@"):
            yield from blocks(body, (ctx + " " + sel).strip())
        else:
            yield ctx, sel, body
        i = e


def decls(*paths):
    for path in paths:
        src = re.sub(r"/\*[\s\S]*?\*/", "", open(path).read())
        for ctx, sel, body in blocks(src):
            for d in split(body):
                p, v = d.split(":", 1)
                yield ctx, sel, p.strip().lower(), re.sub(r"\s+", " ", v).strip()


old = list(decls(sys.argv[1], sys.argv[2]))
new = list(decls(sys.argv[3], sys.argv[4]))
had = {p for c, s, p, v in old if p.startswith("--")}
tokens = {p: v for c, s, p, v in new if s == ":root" and not c and p.startswith("--") and p not in had}


def seqs(ds, subst):
    look, lay = [], []
    for c, s, p, v in ds:
        if subst and s == ":root" and not c and p in tokens:
            continue
        if subst:
            for _ in range(5):  # tokens may name tokens
                v = re.sub(r"var\((--[\w-]+)\)", lambda m: tokens.get(m.group(1), m.group(0)), v)
        (look if LOOK.match(p) and "@keyframes" not in c else lay).append((c, s, p, v))
    return look, lay


a_look, a_lay = seqs(old, False)
b_look, b_lay = seqs(new, True)
bad = 0
for name, x, y in (("look", a_look, b_look), ("layout", a_lay, b_lay)):
    if x == y:
        print(f"{name}: {len(x)} declarations, same order, same values")
        continue
    bad += 1
    n = next((i for i, (p, q) in enumerate(zip(x, y)) if p != q), min(len(x), len(y)))
    print(f"{name}: differs at #{n} ({len(x)} before, {len(y)} after)")
    print("  before:", x[n] if n < len(x) else None)
    print("  after: ", y[n] if n < len(y) else None)
print(f"new :root tokens and hooks: {len(tokens)}")
sys.exit(1 if bad else 0)
