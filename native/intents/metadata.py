#!/usr/bin/env python3
"""N8: Metadata.appintents without Xcode. iOS finds an app's App Intents through Metadata.appintents/ in its bundle,
which Xcode's appintentsmetadataprocessor (macOS only) writes from the Swift compiler's constant values. build.sh
compiles with -emit-const-values-path (the swift.org Linux toolchain has it), and this script turns that JSON into
extract.actionsdata and version.json in the shape Xcode 27 writes (checked against Xcode's own captures: the llios
sample and sweetpad's fixtures, see native/intents/README.md). It covers what iFizBox's intents use and refuses the rest
loudly rather than writing something iOS would skip silently:

  AppIntent         title, description, openAppWhenRun, isDiscoverable, authenticationPolicy; parameters of
                    String, Bool, Int, Double, Date, URL, IntentFile (optional or not, with title and description);
                    the result's ReturnsValue type (those, or an array of them) and ProvidesDialog
  AppShortcutsProvider  AppShortcut(intent:phrases:shortTitle:systemImageName:), phrases with \\(.applicationName)

  metadata.py build <constvalues> <out dir (…/Metadata.appintents)> [--only Id,Id…]
      --only keeps those intents (and the App Shortcuts that run them): the sideload IPA's both-modes set.
  metadata.py check <Metadata.appintents dir> [Id,Id…]
      the files are there and parse, and (given) exactly those intents are listed. Exit 1 with the problems.
SPDX-License-Identifier: GPL-3.0-or-later"""
import json
import os
import sys

TOOLS = "27B52"  # the Xcode build whose output this follows (the iOS 27.1 SDK's)

PRIMITIVES = {
    "Swift.String": 0, "Swift.Bool": 1, "Swift.Int": 2, "Swift.Double": 7, "Swift.Float": 7,
    "Foundation.Date": 8, "Foundation.URL": 11,
}
# What Shortcuts may coerce into a parameter of each primitive type (Xcode's resolvableInputTypes).
RESOLVERS = {0: [2, 0], 1: [1], 2: [2, 7, 0], 7: [2, 7, 0], 8: [8], 11: [0, 11]}


class Unsupported(Exception):
    pass


def localized(key):
    return {"alternatives": [], "key": key}


def primitive(i):
    return {"primitive": {"wrapper": {"typeIdentifier": i}}}


def array_of(member):
    return {"array": {"wrapper": {"capabilities": 3, "memberValueType": member}}}


def optional(name):
    if name.startswith("Swift.Optional<") and name.endswith(">"):
        return name[len("Swift.Optional<"):-1], True
    return name, False


def value_type(name):
    name, _ = optional(name)
    if name.startswith("Swift.Array<") and name.endswith(">"):
        return array_of(value_type(name[len("Swift.Array<"):-1]))
    if name in PRIMITIVES:
        return primitive(PRIMITIVES[name])
    if name == "AppIntents.IntentFile":
        return {"intents": {"wrapper": {"typeIdentifier": 12}}}
    raise Unsupported("value type %s" % name)


def resolvers(kind):
    i = kind.get("primitive", {}).get("wrapper", {}).get("typeIdentifier")
    out = [{"kindValue": 0, "valueType": primitive(x)} for x in RESOLVERS.get(i, [])]
    if i == 0:
        out.append({"kindValue": 0, "valueType": array_of(primitive(2))})
    return out


def literal(v):
    """A constant string: a raw literal, or the string inside an initializer (LocalizedStringResource("…"))."""
    kind = v.get("valueKind")
    if kind == "RawLiteral":
        return str(v["value"])
    if kind == "InitCall":
        args = v["value"].get("arguments", [])
        for a in args:
            if a.get("label") in ("title", "name", "key", "stringLiteral", "description", ""):
                return literal(a)
        if args:
            return literal(args[0])
    raise Unsupported("a constant string, got %s" % kind)


def conforms(t, name):
    if any(c.rsplit(".", 1)[-1] == name for c in t.get("conformances", [])):
        return True
    return any(c.get("protocolName", "").rsplit(".", 1)[-1] == name for c in t.get("allConformances", []))


def identifier(t):
    return t["typeName"].split(".", 1)[1] if "." in t["typeName"] else t["typeName"]


def prop(t, label):
    return next((p for p in t.get("properties", []) if p.get("label") == label), None)


def boolean(t, label, default):
    p = prop(t, label)
    if p is None:
        return default
    v = str(p.get("value"))
    if v in ("true", "1"):
        return True
    if v in ("false", "0"):
        return False
    raise Unsupported("%s of %s must be a constant true or false" % (label, identifier(t)))


def is_parameter(p):
    """An @Parameter property: the compiler gives the wrapped property (label "x", computed) an IntentParameter
    initializer; older compilers list it under propertyWrappers instead."""
    if p.get("isStatic") == "true" or p.get("label", "").startswith(("_", "$")):
        return False
    if any(str(w.get("type", "")).endswith(".IntentParameter") or ".IntentParameter<" in str(w.get("type", ""))
           for w in p.get("propertyWrappers", [])):
        return True
    v = p.get("value")
    return p.get("valueKind") == "InitCall" and isinstance(v, dict) and str(v.get("type", "")).startswith("AppIntents.IntentParameter<")


def parameter(p):
    wrappers = [w for w in p.get("propertyWrappers", []) if "IntentParameter" in str(w.get("type", ""))]
    args = wrappers[0].get("arguments", []) if wrappers else p["value"].get("arguments", [])
    allowed = {"title", "description", "default", "requestValueDialog", "inputConnectionBehavior"}
    for a in args:
        if a.get("label") not in allowed and a.get("valueKind") != "NilLiteral":
            raise Unsupported("parameter option %s on %s" % (a.get("label"), p["label"]))
    title = next((a for a in args if a.get("label") == "title"), None)
    if title is None:
        raise Unsupported("parameter %s has no constant title" % p["label"])
    default = next((a for a in args if a.get("label") == "default" and a.get("valueKind") != "NilLiteral"), None)
    if default is not None:
        raise Unsupported("parameter defaults (%s)" % p["label"])
    conn = next((a for a in args if a.get("label") == "inputConnectionBehavior"), None)
    connection = 0
    if conn is not None and conn.get("valueKind") not in ("NilLiteral",):
        name = (conn.get("value") or {}).get("name") if isinstance(conn.get("value"), dict) else None
        if name in (None, "default"):
            connection = 0
        elif name == "connectToPreviousIntentResult":
            connection = 2
        else:
            raise Unsupported("inputConnectionBehavior %s" % name)
    name, is_opt = optional(p["type"])
    kind = value_type(name)
    out = {
        "capabilities": 0, "dynamicOptionsSupport": 0, "inputConnectionBehavior": connection,
        "isInput": connection != 0, "isOptional": is_opt, "name": p["label"], "resolvableInputTypes": resolvers(kind),
        "title": localized(literal(title)), "typeSpecificMetadata": [], "valueType": kind,
    }
    desc = next((a for a in args if a.get("label") == "description" and a.get("valueKind") != "NilLiteral"), None)
    if desc is not None:
        out["parameterDescription"] = localized(literal(desc))
    return out


def action(t):
    ident = identifier(t)
    if prop(t, "supportedModes") is not None:
        raise Unsupported("explicit supportedModes on %s" % ident)
    title = prop(t, "title")
    if title is None:
        raise Unsupported("intent %s has no constant title" % ident)
    open_app = boolean(t, "openAppWhenRun", False)
    discoverable = boolean(t, "isDiscoverable", True)
    auth = 0
    pol = prop(t, "authenticationPolicy")
    if pol is not None:
        auth = {"alwaysAllowed": 0, "requiresAuthentication": 1, "requiresLocalDeviceAuthentication": 2}.get(
            (pol.get("value") or {}).get("name"))
        if auth is None:
            raise Unsupported("authenticationPolicy of %s" % ident)
    a = {
        "assistantDefinedSchemaTraits": [], "assistantDefinedSchemas": [], "authenticationPolicy": auth,
        "availabilityAnnotations": {"LNPlatformNameWildcard": {"introducedVersion": "*"}},
        "effectiveBundleIdentifiers": [], "fullyQualifiedTypeName": t["typeName"], "identifier": ident,
        "isAuthPolExplicit": pol is not None, "isDiscoverable": discoverable, "mangledTypeName": t["mangledTypeName"],
        "mangledTypeNameByBundleIdentifier": {}, "mangledTypeNameByBundleIdentifierV2": {},
        "mangledTypeNameV2": t["mangledTypeName"], "openAppWhenRun": open_app, "outputFlags": 0, "parameters": [],
        "presentationStyle": 0, "requiredCapabilities": [], "supportedModes": 2 if open_app else 1,
        "systemProtocolMetadata": [], "systemProtocolMetadataV2": [], "systemProtocols": [],
        "title": localized(literal(title)), "typeSpecificMetadata": [],
        "visibilityMetadata": {"assistantOnly": False, "isDiscoverable": discoverable},
    }
    desc = prop(t, "description")
    if desc is not None:
        a["descriptionMetadata"] = {"descriptionText": localized(literal(desc)), "searchKeywords": []}
    a["parameters"] = [parameter(p) for p in t.get("properties", []) if is_parameter(p)]
    for alias in t.get("associatedTypeAliases", []):
        if alias.get("typeAliasName") != "PerformResult":
            continue
        for req in alias.get("opaqueTypeProtocolRequirements", []):
            # Xcode 17F113 writes 4 for ProvidesDialog alone, and Xcode 27B52 6 for ProvidesDialog & ShowsSnippetView.
            if req == "AppIntents.ProvidesDialog":
                a["outputFlags"] |= 4
            elif req == "AppIntents.ShowsSnippetView":
                a["outputFlags"] |= 2
        for same in alias.get("opaqueTypeSameTypeRequirements", []):
            if same.get("typeAliasName") == "AppIntents.IntentResult.Value":
                a["outputType"] = value_type(same["substitutedTypeName"])
    return a


def phrase(v):
    if v.get("valueKind") == "RawLiteral":
        return str(v["value"])
    if v.get("valueKind") != "InterpolatedStringLiteral":
        raise Unsupported("an App Shortcut phrase must be a constant string")
    out = ""
    for seg in v["value"]["segments"]:
        if seg.get("valueKind") == "RawLiteral":
            out += str(seg["value"])
        elif seg.get("valueKind") == "Enum" and seg["value"].get("name") == "applicationName":
            out += "${applicationName}"
        else:
            raise Unsupported("App Shortcut phrases may only interpolate .applicationName")
    return out


def shortcut_items(v, out):
    kind = v.get("valueKind")
    if kind == "Builder":
        for m in v["value"].get("members", []):
            shortcut_items(m["element"], out)
    elif kind == "Array":
        for x in v["value"]:
            shortcut_items(x, out)
    elif kind == "InitCall" and v["value"].get("type") == "AppIntents.AppShortcut":
        args = {a.get("label"): a for a in v["value"].get("arguments", [])}
        for need in ("intent", "phrases", "shortTitle", "systemImageName"):
            if need not in args:
                raise Unsupported("an AppShortcut without %s" % need)
        intent = args["intent"]["type"].split(".", 1)[-1]
        out.append({
            "actionIdentifier": intent,
            "availabilityAnnotations": {"LNPlatformNameWildcard": {"introducedVersion": "*"}},
            "phraseTemplates": [localized(phrase(p)) for p in args["phrases"]["value"]],
            "shortTitle": localized(literal(args["shortTitle"])),
            "systemImageName": literal(args["systemImageName"]),
        })
    else:
        raise Unsupported("App Shortcuts builder value %s" % kind)


def extract(types, only=None):
    result = {
        "actions": {}, "assistantEntities": [], "assistantIntentNegativePhrases": [], "assistantIntents": [],
        "autoShortcuts": [], "entities": {}, "enums": [], "generator": {"name": "xcode-tools", "version": TOOLS},
        "negativePhrases": [], "queries": {}, "shortcutTileColor": 14, "version": 1,
    }
    providers = [t for t in types if conforms(t, "AppShortcutsProvider")]
    if len(providers) > 1:
        raise Unsupported("more than one AppShortcutsProvider")
    for t in types:
        if t.get("typeName") == "Swift.Never":
            continue
        for p in ("AppEntity", "EntityQuery", "AppEnum", "AppIntentsPackage", "WidgetConfigurationIntent"):
            if conforms(t, p):
                raise Unsupported("%s (%s) is not handled here" % (p, t["typeName"]))
        if conforms(t, "AppIntent") and (only is None or identifier(t) in only):
            result["actions"][identifier(t)] = action(t)
    if only is not None:
        missing = sorted(set(only) - set(result["actions"]))
        if missing:
            raise Unsupported("no intent named %s" % ", ".join(missing))
    for t in providers:
        p = prop(t, "appShortcuts")
        if p is None:
            raise Unsupported("an AppShortcutsProvider without appShortcuts")
        items = []
        shortcut_items(p, items)
        items = [s for s in items if s["actionIdentifier"] in result["actions"]]
        if len(items) > 10:
            raise Unsupported("iOS takes at most 10 App Shortcuts")
        if items:
            result["autoShortcutProviderMangledName"] = t["mangledTypeName"]
            result["autoShortcuts"] = items
    return result


def write(out, data):
    with open(out, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")


def build(constvalues, out_dir, only=None):
    with open(constvalues) as f:
        types = json.load(f)
    meta = extract(types, only)
    os.makedirs(out_dir, exist_ok=True)
    write(os.path.join(out_dir, "extract.actionsdata"), meta)
    write(os.path.join(out_dir, "version.json"), {"toolsVersion": TOOLS, "version": "3.0"})
    return meta


def check(out_dir, want=None):
    problems = []
    try:
        with open(os.path.join(out_dir, "extract.actionsdata")) as f:
            meta = json.load(f)
        with open(os.path.join(out_dir, "version.json")) as f:
            ver = json.load(f)
    except (OSError, ValueError) as e:
        return ["Metadata.appintents: %s" % e]
    if meta.get("version") != 1 or not isinstance(meta.get("actions"), dict):
        problems.append("extract.actionsdata is not version 1 with actions")
    if ver.get("version") != "3.0":
        problems.append("version.json version %r" % ver.get("version"))
    have = set(meta.get("actions", {}))
    if want is not None and have != set(want):
        problems.append("intents %s, want %s" % (sorted(have), sorted(want)))
    for s in meta.get("autoShortcuts", []):
        if s.get("actionIdentifier") not in have:
            problems.append("App Shortcut for a missing intent %s" % s.get("actionIdentifier"))
    for ident, a in meta.get("actions", {}).items():
        if not a.get("mangledTypeName") or not a.get("title", {}).get("key"):
            problems.append("%s has no mangled name or title" % ident)
    return problems


def main(argv):
    if len(argv) >= 4 and argv[1] == "build":
        only = None
        if len(argv) == 6 and argv[4] == "--only":
            only = [x for x in argv[5].split(",") if x]
        elif len(argv) != 4:
            print(__doc__, file=sys.stderr)
            return 2
        try:
            meta = build(argv[2], argv[3], only)
        except Unsupported as e:
            print("metadata.py: unsupported: %s" % e, file=sys.stderr)
            return 1
        print("%s: %d intents, %d App Shortcuts" % (argv[3], len(meta["actions"]), len(meta["autoShortcuts"])))
        return 0
    if len(argv) in (3, 4) and argv[1] == "check":
        want = [x for x in argv[3].split(",") if x] if len(argv) == 4 else None
        problems = check(argv[2], want)
        for p in problems:
            print("metadata.py check: %s" % p, file=sys.stderr)
        return 1 if problems else 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
