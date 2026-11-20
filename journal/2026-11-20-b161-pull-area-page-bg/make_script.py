# Writes script.json for capture.mjs: held pulls on Home and Sources, under and past the trigger, in light,
# Gunmetal and Linen (the weave). Each pull goes back under the trigger before the lift, so no refresh starts and
# the next pull still shows its area.
import json

PROBE = ("(()=>{const a=document.querySelector('.pull-clip.on .pull-refresh'); if(!a) return 'no area';"
         "const s=getComputedStyle(a); return [a.parentNode.className, s.backgroundColor, s.backgroundImage.slice(0,90),"
         "a.querySelector('.pull-title').textContent]})()")


def pull(name, to):
    steps = [{"touch": "start", "x": 200, "y": 250}]
    y = 250
    while y < to:
        y = min(to, y + 12)
        steps.append({"touch": "move", "x": 200, "y": y})
    steps += [{"wait": 400}, {"eval": PROBE}, {"shot": name}]
    while y > 262:  # back under the trigger: the lift springs back and runs nothing
        y -= 15
        steps.append({"touch": "move", "x": 200, "y": max(y, 262)})
    steps.append({"touch": "end", "x": 200, "y": 262, "ms": 1200})
    return steps


steps = [{"wait": 2000}, {"eval": "localStorage.setItem('ifizbox.firstVisit','later'); 'ok'"}]
for theme, palette in [("light", "classic"), ("dark", "gunmetal"), ("dark", "linen")]:
    for page in ["home", "sources"]:
        steps.append({"nav": f"#/{page}", "ms": 5000})
        steps.append({"eval": f"document.documentElement.dataset.theme='{theme}'; "
                              f"document.documentElement.dataset.palette='{palette}'; 'ok'"})
        steps.append({"wait": 500})
        tag = f"{page}-{palette}"
        steps += pull(f"{tag}-under", 305)
        steps += pull(f"{tag}-past", 550)
json.dump(steps, open("script.json", "w"), indent=0)
