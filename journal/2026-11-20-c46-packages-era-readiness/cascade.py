#!/usr/bin/env python3
"""C46: prove a look/layout split of a stylesheet keeps its cascade.

Look and layout properties (docs/eras.md, ios6-css.test.js LOOK) are disjoint and no shorthand spans both, so two
versions of a stylesheet cascade the same when, after every token the new one defines on :root is put back in place of
its var(), the sequence of look declarations (selector, property, value, in source order) is the same and so is the
sequence of layout declarations. Rules may move between the two lists' places; nothing may change inside either.

Usage: cascade.py <before.css> <after.css>   Exit 0 when both sequences match."""
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


def rules(path):
    src = re.sub(r"/\*[\s\S]*?\*/", "", open(path).read())
    assert "@" not in re.sub(r"url\([^)]*\)", "", src), f"{path}: at-rules are not handled"
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", src):
        sel = re.sub(r"\s+", " ", sel).strip()
        for d in split(body):
            p, v = d.split(":", 1)
            yield sel, p.strip().lower(), re.sub(r"\s+", " ", v).strip()


def seqs(path, tokens=None):
    tokens = {} if tokens is None else tokens
    decls = list(rules(path))
    own = {p: v for s, p, v in decls if s == ":root" and p.startswith("--")} if tokens == {} else {}
    tokens.update(own)
    look, lay = [], []
    for s, p, v in decls:
        if s == ":root" and p in own:
            continue
        for _ in range(5):  # tokens may name tokens
            v = re.sub(r"var\((--[\w-]+)\)", lambda m: tokens.get(m.group(1), m.group(0)), v)
        (look if LOOK.match(p) else lay).append((s, p, v))
    return look, lay, own


a_look, a_lay, a_own = seqs(sys.argv[1], {"__": ""})
b_look, b_lay, b_own = seqs(sys.argv[2])
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
print(f"tokens the new sheet defines on :root: {len(b_own)}")
sys.exit(1 if bad else 0)
