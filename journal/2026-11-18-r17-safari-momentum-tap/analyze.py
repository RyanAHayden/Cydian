import json, sys, statistics as st
cur = None; out = []
for line in open(sys.argv[1]):
    if line.startswith("=="): cur = line.split()[1:3]; continue
    try: o = json.loads(line)
    except Exception: continue
    fr = o.get("frames") or []
    if not cur or cur[1] != "r17-coast" or len(fr) < 10: continue
    # moving frames: from first change to last change
    pos = [p for _, p in fr]; ts = [t for t, _ in fr]
    ch = [i for i in range(1, len(pos)) if pos[i] != pos[i-1]]
    a, z = ch[0], ch[-1]
    iv = [ts[i] - ts[i-1] for i in range(a, z + 1)]
    dp = [pos[i] - pos[i-1] for i in range(a, z + 1)]
    stalls = sum(1 for i in range(len(dp)) if dp[i] == 0 and i < len(dp) - 1)
    out.append((cur[0], len(iv), round(st.median(iv), 1), round(max(iv), 1), sum(1 for x in iv if x > 20), stalls, round(pos[z] - pos[0]), dp[:8]))
for r in out: print("%-18s frames=%3d median=%5sms max=%5sms >20ms=%d stalls=%d dist=%5d first-deltas=%s" % r)
