#!/usr/bin/env python3
"""C46: split a stylesheet into layout rules and look-only stretches, per blank-line section.
Within a section: the section's leading comments, then every layout rule (and layout half of a mixed rule) in source
order, then one look-only stretch with every look rule (and look half) in source order. Look and layout properties are
disjoint and no shorthand spans both, so keeping each group's order keeps the cascade.
Usage: split.py <in.css> <out.css>"""
import re
import sys

LOOK = re.compile(r"^(--.+|color|color-scheme|accent-color|caret-color|opacity|filter|-webkit-backdrop-filter|backdrop-filter|box-shadow|text-shadow|content|background(-[a-z]+)*|border(-[a-z]+)*|outline(-[a-z]+)*|-webkit-mask(-[a-z]+)*|mask(-[a-z]+)*|font(-[a-z]+)*|line-height|letter-spacing|word-spacing|text-align|text-transform|text-decoration(-[a-z]+)*|-webkit-font-smoothing|-webkit-text-stroke(-[a-z]+)*|fill|stroke(-[a-z]+)*|list-style(-[a-z]+)*)$")

src = open(sys.argv[1]).read()


def split_decls(body):
    """[(decl text, [comments after it])], plus comments before the first decl."""
    out, head = [], []
    i, cur, depth, quote = 0, "", 0, ""
    while i < len(body):
        ch = body[i]
        if not quote and body.startswith("/*", i):
            j = body.index("*/", i) + 2
            c = body[i:j]
            if cur.strip():
                cur += " " + c  # mid-declaration: keep with it
            elif out:
                out[-1][1].append(c)
            else:
                head.append(c)
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
    return head, out


def prop(d):
    return d[: d.index(":")].strip().lower()


def norm(d):
    return re.sub(r"\s*\n\s*", " ", d)


def emit(sel, decls, head=(), trail=""):
    parts = [norm(d) + ";" + "".join(" " + c for c in cs) for d, cs in decls]
    one = f"{sel} {{ " + " ".join(parts) + " }"
    if len(one) <= 120 and not head and "\n" not in one:
        return one + (" " + trail if trail else "")
    lines = [f"{sel} {{" + "".join(" " + c for c in head)]
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


def label(header):
    t = re.sub(r"^/\*\s*(-{4}\s*)?|\s*(-{4}\s*)?\*/$", "", header).strip()
    t = re.sub(r"^[A-Z]\d+[a-z]?(, [A-Z]\d+)*:\s*", "", t)
    t = re.split(r"[:(;.]| — |, from ", t)[0].strip().strip('"')
    return t[:70]


sections = re.split(r"\n[ \t]*\n", src.strip("\n"))
out = []
for sec in sections:
    items = []  # ("c", text) | ("r", sel, body, trail)
    i = 0
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
        # find matching } (no nesting in this file)
        e = b + 1
        quote = ""
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
            elif ch == "}":
                break
            e += 1
        sel = re.sub(r"\s+", " ", sec[i:b]).strip()
        body = sec[b + 1 : e]
        # trailing comment on the same line
        rest = sec[e + 1 :]
        m = re.match(r"[ \t]*(/\*.*?\*/)", rest)
        trail = ""
        orig = sec[i : e + 1]
        if m and "\n" not in rest[: m.start(1)]:
            trail = m.group(1)
            e += m.end()
        items.append(["r", sel, body, trail, orig])
        i = e + 1
    lead = []
    while items and items[0][0] == "c":
        lead.append(items.pop(0)[1])
    lay, look, pending = [], [], []
    for it in items:
        if it[0] == "c":
            pending.append(it[1])
            continue
        _, sel, body, trail, orig = it
        head, decls = split_decls(body)
        L = [d for d in decls if not LOOK.match(prop(d[0]))]
        K = [d for d in decls if LOOK.match(prop(d[0]))]
        if L and K:
            lay += pending + [emit(sel, L, head, trail)]
            look.append(emit(sel, K))
        elif L:
            lay += pending + [orig.strip() + (" " + trail if trail else "")]
        else:
            look += pending + [orig.strip() + (" " + trail if trail else "")]
        pending = []
    lay += pending
    block = list(lead) + lay
    if look:
        name = label(lead[0]) if lead else "these rules"
        block += [f"/* ==== look-only {{ ==== {name} */"] + look + ["/* ==== } look-only ==== */"]
    out.append("\n".join(block))
open(sys.argv[2], "w").write("\n\n".join(out) + "\n")
