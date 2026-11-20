#!/usr/bin/env python3
"""C45: move the layout of ios6.css (after its first look-only stretch) to the end of style.css.

Per blank-line section of ios6.css from line START on (skipping the look-only stretches already there): the section's
comments and look rules (and look halves of mixed rules) stay in ios6.css in source order, inside one look-only
stretch; every layout rule, layout half and at-rule (@media, @keyframes: motion and reduced motion) is appended to
style.css in source order, under a one-line header naming the section. Look and layout properties (ios6-css.test.js
LOOK) are disjoint and no shorthand spans both, and nothing in style.css comes after the appended rules while all of
ios6.css comes after them, so both sequences keep their order: cascade.py checks it.
Usage: split.py <ios6.css> <style.css> <out ios6.css> <out style.css>"""
import re
import sys

LOOK = re.compile(r"^(--.+|color|color-scheme|accent-color|caret-color|opacity|filter|-webkit-backdrop-filter|backdrop-filter|box-shadow|text-shadow|content|background(-[a-z]+)*|border(-[a-z]+)*|outline(-[a-z]+)*|-webkit-mask(-[a-z]+)*|mask(-[a-z]+)*|font(-[a-z]+)*|line-height|letter-spacing|word-spacing|text-align|text-transform|text-decoration(-[a-z]+)*|-webkit-font-smoothing|-webkit-text-stroke(-[a-z]+)*|fill|stroke(-[a-z]+)*|list-style(-[a-z]+)*)$")
OPEN, CLOSE = "/* ==== look-only {", "/* ==== } look-only ==== */"

ios6, style = open(sys.argv[1]).read(), open(sys.argv[2]).read()
first_close = ios6.index(CLOSE) + len(CLOSE)
head, rest = ios6[:first_close], ios6[first_close:]


def split_decls(body):
    out, lead = [], []
    i, cur, depth, quote = 0, "", 0, ""
    while i < len(body):
        ch = body[i]
        if not quote and body.startswith("/*", i):
            j = body.index("*/", i) + 2
            c = body[i:j]
            if cur.strip():
                cur += " " + c
            elif out:
                out[-1][1].append(c)
            else:
                lead.append(c)
            i = j
            continue
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
            out.append([cur.strip(), []])
            cur = ""
            i += 1
            continue
        cur += ch
        i += 1
    if cur.strip():
        out.append([cur.strip(), []])
    return lead, out


def prop(d):
    return d[: d.index(":")].strip().lower()


def norm(d):
    return re.sub(r"\s*\n\s*", " ", d)


def emit(sel, decls, lead=(), trail=""):
    parts = [norm(d) + ";" + "".join(" " + c for c in cs) for d, cs in decls]
    one = f"{sel} {{ " + " ".join(parts) + " }"
    if len(one) <= 120 and not lead and "\n" not in one:
        return one + (" " + trail if trail else "")
    lines = [f"{sel} {{" + "".join(" " + c for c in lead)]
    line = "  "
    for p in parts:
        if line.strip() and len(line) + 1 + len(p) > 120:
            lines.append(line.rstrip())
            line = "  "
        line += p + " "
    if line.strip():
        lines.append(line.rstrip())
    lines.append("}" + (" " + trail if trail else ""))
    return "\n".join(lines)


def label(c):
    t = re.sub(r"^/\*\s*(-{4}\s*)?|\s*(-{4}\s*)?\*/$", "", c).strip()
    t = re.sub(r"^[A-Z]\d+[a-z]?(, [A-Z]\d+)*:\s*", "", t)
    t = re.split(r"[:(;.]| — |, from ", t)[0].strip().strip('"')
    return t[:70]


def items_of(sec):
    items, i = [], 0
    while i < len(sec):
        if sec[i].isspace():
            i += 1
            continue
        if sec.startswith("/*", i):
            j = sec.index("*/", i) + 2
            items.append(["c", sec[i:j]])
            i = j
            continue
        b = sec.index("{", i)
        e, depth, quote = b + 1, 1, ""
        while True:
            ch = sec[e]
            if quote:
                if ch == quote:
                    quote = ""
            elif ch in "\"'":
                quote = ch
            elif sec.startswith("/*", e):
                e = sec.index("*/", e) + 2
                continue
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            e += 1
        sel = re.sub(r"\s+", " ", sec[i:b]).strip()
        orig = sec[i : e + 1]
        tail = sec[e + 1 :]
        m = re.match(r"[ \t]*(/\*.*?\*/)", tail)
        trail = ""
        if m and "\n" not in tail[: m.start(1)]:
            trail = m.group(1)
            e += m.end()
        items.append(["r", sel, orig[orig.index("{") + 1 : -1], trail, orig])
        i = e + 1
    return items


# Cut rest into chunks: existing stretches stay whole; the rest splits per blank-line section.
chunks, pos = [], 0
for m in re.finditer(re.escape(OPEN) + r"[\s\S]*?" + re.escape(CLOSE), rest):
    chunks.append(("split", rest[pos : m.start()]))
    chunks.append(("keep", m.group(0)))
    pos = m.end()
chunks.append(("split", rest[pos:]))

out6, outs = [], []
for kind, text in chunks:
    if kind == "keep":
        out6.append(text.strip("\n"))
        continue
    for sec in re.split(r"\n[ \t]*\n", text.strip("\n")):
        if not sec.strip():
            continue
        items = items_of(sec)
        lead = []
        while items and items[0][0] == "c":
            lead.append(items.pop(0)[1])
        lay, look, pending = [], [], []
        for it in items:
            if it[0] == "c":
                pending.append(it[1])
                continue
            _, sel, body, trail, orig = it
            if sel.startswith("@"):
                lay.append(orig.strip() + (" " + trail if trail else ""))
                look += pending
                pending = []
                continue
            rl, decls = split_decls(body)
            L = [d for d in decls if not LOOK.match(prop(d[0]))]
            K = [d for d in decls if LOOK.match(prop(d[0]))]
            if L and K:
                lay.append(emit(sel, L))
                look += pending + [emit(sel, K, rl, trail)]
            elif L:
                lay.append(emit(sel, L, rl, trail) if rl or trail else orig.strip())
                look += pending
            else:
                look += pending + [orig.strip() + (" " + trail if trail else "")]
            pending = []
        look += pending
        name = label(lead[0]) if lead else "these rules"
        if look:
            out6.append("\n".join(lead + [f"{OPEN} ==== {name} */"] + look + [CLOSE]))
        elif lead:
            out6.append("\n".join(lead))
        if lay:
            outs.append("\n".join([f"/* {name} (ios6.css paints it) */"] + lay))

open(sys.argv[3], "w").write(head + "\n\n" + "\n\n".join(out6) + "\n")
open(sys.argv[4], "w").write(style.rstrip("\n") + "\n\n" + "\n".join(outs) + "\n")
