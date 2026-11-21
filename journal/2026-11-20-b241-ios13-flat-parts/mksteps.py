# Writes steps.json for capture.mjs (--mode sideload): Installed, Changes, Settings, Settings > General (switches),
# Settings > Updates and an Installed app's page, in iOS 13 White and OLED Black.
import json

steps = [{"wait": 2000}]
for tone in ["light", "dark"]:
    steps += [
        {"eval": "(()=>{localStorage.clear();localStorage.setItem('ifizbox.firstVisit','later');"
                 f"localStorage.setItem('ifizbox.style','ios13');localStorage.setItem('ifizbox.appearance','{tone}');return 'ok'}})()"},
        {"nav": "#/installed", "ms": 6000}, {"shot": f"{tone}-installed"},
        {"clicktext": "Alpha", "ms": 3000}, {"shot": f"{tone}-app"},
        {"nav": "#/changes", "ms": 8000}, {"shot": f"{tone}-changes"},
        {"nav": "#/home/settings", "ms": 3000}, {"shot": f"{tone}-settings"},
        {"clicktext": "General", "ms": 2500},
        # the last switch drawn off (its attribute only, for the picture; the setting is untouched)
        {"eval": "(()=>{const s=[...document.querySelectorAll('.page.is-top .switch')].at(-1);if(!s)return 'none';"
                 "s.setAttribute('aria-checked','false');return 'ok'})()"},
        {"wait": 500}, {"shot": f"{tone}-general"},
        {"nav": "#/home/settings", "ms": 2000}, {"clicktext": "Updates", "ms": 2500}, {"shot": f"{tone}-updates"},
    ]
json.dump(steps, open("steps.json", "w"))
