"""A small ES module bundler for web/app (stdlib only), for tools/concept/build.py.

The concept page runs the app inside an iframe built from one inline script, so its modules can't load as files.
Each module becomes an async function in a registry, with ES module meaning kept where the app relies on it:

- imports are live: the module body runs inside `with (imports)`, whose getters read the exporting module's
  current binding (so `export let x` reassigned later is seen, as with real modules);
- a module's static imports run first, in source order; top-level await works (every module is async);
- `import("./x.js")` and `import.meta.url` are rewritten to the registry's own (`import.meta.url` is
  concept://app/<path>, which the in-frame shell maps back to the app's files and images).

Only the syntax the app uses is handled (no default imports or exports: AGENTS.md's modules don't use them);
anything else fails the build loudly, as does an import of a name the other module doesn't export.
"""
import ast
import json
import posixpath
import re

IDENT_START = re.compile(r"[A-Za-z_$\u0080-￿]")
IDENT = re.compile(r"[A-Za-z0-9_$\u0080-￿]*")
NUMBER = re.compile(r"(?:0[xXbBoO][0-9a-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)")
REGEX_AFTER_WORD = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw",
                    "instanceof", "yield", "await"}
REGEX_AFTER_PUNCT = set("(,=:[!&|?{};+-*%<>~^")


class BundleError(Exception):
    pass


class Tok:
    __slots__ = ("kind", "text", "start", "end")

    def __init__(self, kind, text, start, end):
        self.kind, self.text, self.start, self.end = kind, text, start, end

    def __repr__(self):
        return f"Tok({self.kind},{self.text!r})"


def tokenize(src, i=0, until_brace=False):
    """Tokens of src from i: ws, comment, str, tpl, regex, num, ident, punct. With until_brace, stops at the `}`
    that closes a template's `${` (returns (tokens, index after it))."""
    toks, n, depth, last = [], len(src), 0, None  # last: the last significant token

    def regex_ok():
        if last is None:
            return True
        if last.kind == "ident":
            return last.text in REGEX_AFTER_WORD
        if last.kind == "punct":
            return last.text in REGEX_AFTER_PUNCT or last.text == "}"
        return False

    while i < n:
        c = src[i]
        s = i
        if c in " \t\r\n﻿   ":
            while i < n and src[i] in " \t\r\n﻿   ":
                i += 1
            toks.append(Tok("ws", src[s:i], s, i))
            continue
        if src.startswith("//", i):
            e = src.find("\n", i)
            i = n if e < 0 else e
            toks.append(Tok("comment", src[s:i], s, i))
            continue
        if src.startswith("/*", i):
            e = src.find("*/", i + 2)
            if e < 0:
                raise BundleError(f"unclosed comment at {i}")
            i = e + 2
            toks.append(Tok("comment", src[s:i], s, i))
            continue
        if c in "'\"":
            i += 1
            while i < n and src[i] != c:
                if src[i] == "\\":
                    i += 1
                elif src[i] == "\n":
                    raise BundleError(f"unclosed string at {s}")
                i += 1
            i += 1
            last = Tok("str", src[s:i], s, i)
            toks.append(last)
            continue
        if c == "`":
            i += 1
            while True:
                if i >= n:
                    raise BundleError(f"unclosed template at {s}")
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "`":
                    i += 1
                    break
                if src.startswith("${", i):
                    _, i = tokenize(src, i + 2, until_brace=True)
                    continue
                i += 1
            last = Tok("tpl", src[s:i], s, i)
            toks.append(last)
            continue
        if c == "/" and regex_ok():
            i += 1
            in_class = False
            while i < n:
                ch = src[i]
                if ch == "\\":
                    i += 2
                    continue
                if ch == "\n":
                    raise BundleError(f"unclosed regex at {s}: {src[s:s + 40]!r}")
                if in_class:
                    in_class = ch != "]"
                elif ch == "[":
                    in_class = True
                elif ch == "/":
                    break
                i += 1
            i += 1
            while i < n and (src[i].isalnum()):
                i += 1
            last = Tok("regex", src[s:i], s, i)
            toks.append(last)
            continue
        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            m = NUMBER.match(src, i)
            i = m.end() if m and m.end() > i else i + 1
            last = Tok("num", src[s:i], s, i)
            toks.append(last)
            continue
        if IDENT_START.match(c) or c == "\\" or c == "#":
            i += 1
            i = IDENT.match(src, i).end()
            last = Tok("ident", src[s:i], s, i)
            toks.append(last)
            continue
        # punctuation, one char at a time ("..." is three dots, "=>" two tokens)
        if until_brace:
            if c == "{":
                depth += 1
            elif c == "}":
                if depth == 0:
                    return toks, i + 1
                depth -= 1
        i += 1
        last = Tok("punct", c, s, i)
        toks.append(last)
    if until_brace:
        raise BundleError("unclosed ${ in a template")
    return toks, i


def _sig(toks, k):
    """Index of the next significant token at or after k (len(toks) when none)."""
    while k < len(toks) and toks[k].kind in ("ws", "comment"):
        k += 1
    return k


def _str_value(tok):
    if tok.kind != "str":
        raise BundleError(f"expected a module specifier, got {tok.text!r}")
    return ast.literal_eval(tok.text)


def resolve(spec, importer):
    """The registry path of spec imported from importer (both relative to web/app)."""
    if not spec.startswith((".", "/")):
        return None
    p = posixpath.normpath(posixpath.join(posixpath.dirname(importer), spec))
    return None if p.startswith("..") else p


def _names_clause(toks, k):
    """Parse `{ a, b as c, }` starting at toks[k] == "{". Returns ([(name, local)], index after "}")."""
    out, k = [], k + 1
    while True:
        k = _sig(toks, k)
        if k >= len(toks):
            raise BundleError("unclosed { in an import or export")
        t = toks[k]
        if t.text == "}":
            return out, k + 1
        if t.text == ",":
            k += 1
            continue
        if t.kind not in ("ident", "str"):
            raise BundleError(f"unexpected {t.text!r} in an import or export list")
        name = t.text if t.kind == "ident" else _str_value(t)
        local = name
        k2 = _sig(toks, k + 1)
        if k2 < len(toks) and toks[k2].text == "as":
            k3 = _sig(toks, k2 + 1)
            local = toks[k3].text if toks[k3].kind == "ident" else _str_value(toks[k3])
            k = k3 + 1
        else:
            k += 1
        out.append((name, local))


def _end_semicolon(toks, k):
    """Index after an optional `;` following toks[k-1]."""
    k2 = _sig(toks, k)
    return k2 + 1 if k2 < len(toks) and toks[k2].text == ";" else k


CONTINUE_AFTER = set(",=([{?:+-*/%&|.<>!~^")
CONTINUE_BEFORE = set(",.?:+-*/%&|=)]}>")


def _declared_names(toks, k):
    """Names declared by `const|let|var` whose keyword is toks[k-1]: the identifier at the start of each
    top-level declarator. Destructuring isn't supported."""
    names, depth, expect, prev = [], 0, True, None
    while k < len(toks):
        t = toks[k]
        if t.kind == "ws":
            if depth == 0 and "\n" in t.text and prev is not None and not expect:
                nxt = _sig(toks, k)
                nt = toks[nxt] if nxt < len(toks) else None
                if prev.text not in CONTINUE_AFTER and (nt is None or nt.text not in CONTINUE_BEFORE):
                    return names
            k += 1
            continue
        if t.kind == "comment":
            k += 1
            continue
        if t.kind == "punct":
            if t.text in "([{":
                if depth == 0 and expect:
                    raise BundleError("destructuring in an export isn't supported")
                depth += 1
            elif t.text in ")]}":
                depth -= 1
                if depth < 0:
                    return names
            elif depth == 0 and t.text == ",":
                expect = True
            elif depth == 0 and t.text == ";":
                return names
        elif t.kind == "ident" and depth == 0 and expect:
            names.append(t.text)
            expect = False
        prev = t
        k += 1
    return names


def transform(src, path):
    """(wrapped source, info) for one module. info: imports [(local, dep, name|'*')], deps [dep, ...] in order,
    exports {exported: local} (locals), reexports [(exported, dep, name|'*')], star [dep]."""
    toks, _ = tokenize(src)
    edits = []  # (start, end, replacement)
    imports, deps, exports, reexports, star = [], [], {}, [], []

    def dep_of(tok):
        spec = _str_value(tok)
        d = resolve(spec, path)
        if d is None:
            raise BundleError(f"{path}: can't bundle the import of {spec!r}")
        if d not in deps:
            deps.append(d)
        return d

    depth, k = 0, 0
    while k < len(toks):
        t = toks[k]
        if t.kind == "punct":
            if t.text in "([{":
                depth += 1
            elif t.text in ")]}":
                depth -= 1
            k += 1
            continue
        if t.kind == "tpl" and ("import(" in t.text or "import.meta" in t.text):
            txt = t.text.replace("import.meta", f"__cMeta({json.dumps(path)})")
            txt = re.sub(r"(?<![\w$.])import\(", f"__cDyn({json.dumps(path)})(", txt)
            edits.append((t.start, t.end, txt))
            k += 1
            continue
        if t.kind != "ident" or t.text not in ("import", "export"):
            k += 1
            continue
        p = k - 1
        while p >= 0 and toks[p].kind in ("ws", "comment"):
            p -= 1
        after_dot = p >= 0 and toks[p].text == "."
        n1 = _sig(toks, k + 1)
        nt = toks[n1] if n1 < len(toks) else None
        if t.text == "import" and nt is not None and nt.text == "(" and not after_dot:
            edits.append((t.start, t.end, f"__cDyn({json.dumps(path)})"))
            k += 1
            continue
        if t.text == "import" and nt is not None and nt.text == "." and not after_dot:
            n2 = _sig(toks, n1 + 1)
            if toks[n2].text != "meta":
                raise BundleError(f"{path}: import.{toks[n2].text}")
            edits.append((t.start, toks[n2].end, f"__cMeta({json.dumps(path)})"))
            k = n2 + 1
            continue
        if after_dot or depth != 0:
            k += 1
            continue
        if t.text == "import":
            if nt.kind == "str":  # import "x";
                dep_of(nt)
                end = _end_semicolon(toks, n1 + 1)
            elif nt.text == "*":
                a = _sig(toks, n1 + 1)
                loc = _sig(toks, a + 1)
                fr = _sig(toks, loc + 1)
                sp = _sig(toks, fr + 1)
                if toks[a].text != "as" or toks[fr].text != "from":
                    raise BundleError(f"{path}: odd import * at {t.start}")
                imports.append((toks[loc].text, dep_of(toks[sp]), "*"))
                end = _end_semicolon(toks, sp + 1)
            elif nt.text == "{":
                names, after = _names_clause(toks, n1)
                fr = _sig(toks, after)
                sp = _sig(toks, fr + 1)
                if toks[fr].text != "from":
                    raise BundleError(f"{path}: import without from at {t.start}")
                d = dep_of(toks[sp])
                imports.extend((local, d, name) for name, local in names)
                end = _end_semicolon(toks, sp + 1)
            else:
                raise BundleError(f"{path}: default imports aren't supported ({nt.text!r} at {t.start})")
            edits.append((t.start, toks[end - 1].end, ""))
            k = end
            continue
        # export
        if nt.text == "{":
            names, after = _names_clause(toks, n1)
            fr = _sig(toks, after)
            if fr < len(toks) and toks[fr].text == "from":
                sp = _sig(toks, fr + 1)
                d = dep_of(toks[sp])
                reexports.extend((local, d, name) for name, local in names)
                end = _end_semicolon(toks, sp + 1)
            else:
                for name, local in names:
                    exports[local] = name
                end = _end_semicolon(toks, after)
            edits.append((t.start, toks[end - 1].end, ""))
            k = end
            continue
        if nt.text == "*":
            a = _sig(toks, n1 + 1)
            if toks[a].text == "as":
                loc = _sig(toks, a + 1)
                fr = _sig(toks, loc + 1)
                sp = _sig(toks, fr + 1)
                reexports.append((toks[loc].text, dep_of(toks[sp]), "*"))
            else:
                sp = _sig(toks, a + 1)
                star.append(dep_of(toks[sp]))
            end = _end_semicolon(toks, sp + 1)
            edits.append((t.start, toks[end - 1].end, ""))
            k = end
            continue
        if nt.text == "default":
            raise BundleError(f"{path}: export default isn't supported")
        # export [async] function* name / class name / const|let|var names
        kw = n1
        if toks[kw].text == "async":
            kw = _sig(toks, kw + 1)
        word = toks[kw].text
        if word in ("function", "class"):
            nm = _sig(toks, kw + 1)
            if toks[nm].text == "*":
                nm = _sig(toks, nm + 1)
            exports[toks[nm].text] = toks[nm].text
        elif word in ("const", "let", "var"):
            for name in _declared_names(toks, kw + 1):
                exports[name] = name
        else:
            raise BundleError(f"{path}: export {word!r} isn't supported")
        edits.append((t.start, nt.start, ""))  # drop "export " only
        k = n1
    out, pos = [], 0
    for s, e, r in sorted(edits):
        out.append(src[pos:s])
        out.append(r)
        pos = e
    out.append(src[pos:])
    body = "".join(out)
    info = {"imports": imports, "deps": deps, "exports": exports, "reexports": reexports, "star": star}
    return body, info


def wrap(path, body, info):
    """One registry entry: __cDef(path, async function (exports) {...})."""
    P = json.dumps(path)
    lines = [f"__cDef({P}, async function (__cX) {{",
             f"const __cI = __cImports({json.dumps([list(i) for i in info['imports']])});"]
    for d in info["deps"]:
        lines.append(f"await __cLoad({json.dumps(d)});")
    if info["reexports"] or info["star"]:
        lines.append(f"__cRe(__cX, {json.dumps([list(r) for r in info['reexports']])}, {json.dumps(info['star'])});")
    lines.append("with (__cI) {")
    if info["exports"]:
        getters = ", ".join(f"{json.dumps(exp)}: () => {local}" for local, exp in info["exports"].items())
        lines.append(f"__cE(__cX, {{ {getters} }});")
    lines.append(body)
    lines.append("}\n});")
    return "\n".join(lines)


RUNTIME = r"""
const __cMods = Object.create(null), __cNs = Object.create(null), __cDone = Object.create(null);
const __cBase = "concept://app/";
function __cDef(p, f) { __cMods[p] = f; }
function __cNsOf(p) { return __cNs[p] || (__cNs[p] = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } })); }
function __cE(x, getters) { for (const k in getters) Object.defineProperty(x, k, { get: getters[k], enumerable: true }); }
function __cImports(list) {
  const o = Object.create(null);
  for (const [local, dep, name] of list) {
    const ns = __cNsOf(dep);
    Object.defineProperty(o, local, name === "*" ? { value: ns } : { get: () => ns[name] });
  }
  return o;
}
function __cRe(x, list, stars) {
  for (const [exp, dep, name] of list) {
    const ns = __cNsOf(dep);
    Object.defineProperty(x, exp, name === "*" ? { value: ns, enumerable: true } : { get: () => ns[name], enumerable: true });
  }
  for (const dep of stars) {
    const ns = __cNsOf(dep);
    for (const k of Object.keys(ns)) if (!(k in x)) Object.defineProperty(x, k, { get: () => ns[k], enumerable: true });
  }
}
function __cLoad(p) {
  if (!__cDone[p]) __cDone[p] = (async () => {
    const f = __cMods[p];
    if (!f) throw new TypeError("Failed to fetch dynamically imported module: " + __cBase + p);
    await f.call(undefined, __cNsOf(p));
    return __cNsOf(p);
  })();
  return __cDone[p];
}
function __cResolve(spec, from) {
  if (typeof spec !== "string" || !/^\.{1,2}\//.test(spec)) return null;
  const parts = from.split("/").slice(0, -1);
  for (const s of spec.split("/")) { if (s === "..") parts.pop(); else if (s !== ".") parts.push(s); }
  return parts.join("/");
}
function __cDyn(from) {
  return (spec) => {
    const p = __cResolve(String(spec), from);
    return p ? __cLoad(p) : Promise.reject(new TypeError("concept: can't import " + spec));
  };
}
function __cMeta(from) { return { url: __cBase + from }; }
"""


def bundle(sources, entry):
    """sources: {path: text}. Returns (script text, {path: info}). Checks every import names an export."""
    infos, parts = {}, [RUNTIME]
    for path in sorted(sources):
        body, info = transform(sources[path], path)
        infos[path] = info
        parts.append(wrap(path, body, info))
    exported = {}

    def exports_of(p, seen=()):
        if p in exported:
            return exported[p]
        info = infos[p]
        names = set(info["exports"].values()) | {r[0] for r in info["reexports"]}
        for d in info["star"]:
            if d not in seen:
                names |= exports_of(d, seen + (p,))
        exported[p] = names
        return names

    problems = []
    for path, info in infos.items():
        for local, dep, name in info["imports"] + [(r[0], r[1], r[2]) for r in info["reexports"]]:
            if dep not in infos:
                problems.append(f"{path}: imports {dep}, which isn't bundled")
            elif name != "*" and name not in exports_of(dep):
                problems.append(f"{path}: imports {name!r} from {dep}, which doesn't export it")
    if entry not in infos:
        problems.append(f"no entry module {entry}")
    if problems:
        raise BundleError("\n".join(problems))
    parts.append(f"__cLoad({json.dumps(entry)}).catch((e) => console.error(e));")
    return "\n".join(parts), infos
