# Writes script.json for capture.mjs: on Sources (plain) and Home (grouped), a script-mode pull past the trigger
# and a lift there; then the refresh is held "running" by hand (globalThis.ifizboxRefreshing = 1 and its event, as
# screens/sources.js announces it) so the held area can be shot, then ended (count back to 0) and shot while the list
# slides back and after it is hidden. PROBE prints the area's state at each step.
import json

PROBE = ("(()=>{const c=document.querySelector('.page.is-top .pull-clip')||document.querySelector('.pull-clip');"
         "if(!c) return 'no clip'; const a=c.querySelector('.pull-refresh'); const sc=c.previousElementSibling;"
         "const kids=[...sc.children].map(k=>k.style.transform||'-');"
         "const sp=getComputedStyle(a.querySelector('.pull-spinner')); const ar=getComputedStyle(a.querySelector('.pull-arrow'));"
         "return {on:c.classList.contains('on'), cls:a.className, title:a.querySelector('.pull-title').textContent,"
         "time:a.querySelector('.pull-time').textContent, area:a.style.transform, kids:[...new Set(kids)],"
         "spinner:sp.visibility+' '+sp.animationName, arrow:ar.visibility+' '+ar.transform, top:sc.scrollTop,"
         "anims:document.getAnimations().length, count:globalThis.ifizboxRefreshing,"
         "reloadBar:document.documentElement.classList.contains('has-reload')}})()")

SET = "globalThis.ifizboxRefreshing={n}; dispatchEvent(new Event('ifizbox:refreshing')); 'ok'"


def pull_and_hold(tag):
    steps = [{"touch": "start", "x": 200, "y": 250}]
    y = 250
    while y < 550:
        y = min(550, y + 12)
        steps.append({"touch": "move", "x": 200, "y": y})
    steps += [{"wait": 300}, {"eval": PROBE}, {"shot": f"{tag}-1-armed"}]
    steps.append({"touch": "end", "x": 200, "y": 550, "ms": 10})
    steps.append({"eval": SET.format(n=1)})
    steps += [{"wait": 120}, {"eval": PROBE}, {"shot": f"{tag}-2-sliding"}]
    steps += [{"wait": 1500}, {"eval": PROBE}, {"shot": f"{tag}-3-held"}]
    # a second pull while held: blocked, the area stays as it is
    steps += [{"touch": "start", "x": 200, "y": 300}, {"touch": "move", "x": 200, "y": 420},
              {"touch": "end", "x": 200, "y": 420, "ms": 300}, {"eval": PROBE}, {"shot": f"{tag}-4-held-after-pull"}]
    steps.append({"eval": SET.format(n=0)})
    # the page's own refresh (real network through the fake shell) may still run: wait until nothing does
    steps.append({"eval": "new Promise(r=>{const t0=Date.now();const f=()=>{const c=document.querySelector('.pull-clip.on');"
                          "const k=c&&c.previousElementSibling.children[0];"
                          "if(!k||!k.style.transform.includes('60px')||Date.now()-t0>60000) return r(Date.now()-t0); setTimeout(f,20)};f()})"})
    steps += [{"wait": 100}, {"eval": PROBE}, {"shot": f"{tag}-5-closing"}]
    steps += [{"wait": 900}, {"eval": PROBE}, {"shot": f"{tag}-6-reset"}]
    return steps


steps = [{"wait": 2000}, {"eval": "localStorage.setItem('ifizbox.firstVisit','later'); 'ok'"}]
for page in ["sources", "home"]:
    steps.append({"nav": f"#/{page}", "ms": 5000})
    steps += pull_and_hold(page)
json.dump(steps, open("script.json", "w"), indent=0)
