import re, sys
KEEP = re.compile(r"cydian\\?\.dev\b|RyanAHayden\\?/Cydian\b|releases/download/test-fixtures/[\w.-]+|^name = \"cydian-sign\"$|releases/download/v[\d.]+/Cydian\.(?:ipa|deb)\b", re.I | re.M)
def ren(t):
    out = []; last = 0
    def sub(s):
        s = s.replace("6Cydian", "7iFizBox")
        return s.replace("cydian", "ifizbox").replace("CYDIAN", "IFIZBOX").replace("Cydian", "iFizBox")
    for m in KEEP.finditer(t):
        out.append(sub(t[last:m.start()])); out.append(m.group(0)); last = m.end()
    out.append(sub(t[last:]))
    return "".join(out)
if __name__ == "__main__":
    for p in sys.argv[1:]:
        try: t = open(p, encoding="utf-8").read()
        except (UnicodeDecodeError, IsADirectoryError): continue
        n = ren(t)
        if n != t: open(p, "w", encoding="utf-8").write(n)
