import json, sys
style, app = sys.argv[1], sys.argv[2]
p = f"{style}-{app}-"
steps = [
 {"wait": 1500},
 {"eval": f"localStorage.setItem('ifizbox.firstVisit','later'); localStorage.setItem('ifizbox.style','{style}'); localStorage.setItem('ifizbox.appearance','{app}'); 'ok'"},
 {"nav": "#/home", "ms": 3500},
 {"shot": p+"home"},
 {"eval": "document.querySelector('.page.is-top .page-body').scrollTop=2000; 'ok'"},
 {"wait": 500},
 {"shot": p+"home-bottom"},
 {"eval": "document.querySelector('.page.is-top .page-body').scrollTop=0; 'ok'"},
 {"clicktext": "About", "ms": 1200},
 {"shot": p+"about"},
 {"eval": "document.querySelector('.alert-button:last-child').click(); 'ok'"},
 {"wait": 800},
 {"eval": "import('./nav/alert.js').then(m=>{m.showAlert({title:'Enter Cydia/APT URL', input:{placeholder:'http://', paste:true, value:''}, buttons:['Cancel','Add Source']}); return 'ok'})"},
 {"wait": 900},
 {"shot": p+"prompt"},
 {"eval": "document.querySelector('.alert-button').click(); 'ok'"},
 {"wait": 800},
 {"eval": "import('./nav/alert.js').then(m=>{m.showAlert({title:'Delete 2 Apps?', message:'iSH and iTorrent are removed from this iPhone.', buttons:['Cancel','Keep Data','Delete'], colors:{2:'red'}}); return 'ok'})"},
 {"wait": 900},
 {"shot": p+"alert-stacked"},
 {"eval": "document.querySelector('.alert-button').click(); 'ok'"},
 {"wait": 800},
 {"nav": "#/installed", "ms": 4000},
 {"clicktext": "Manage", "ms": 1200},
 {"eval": "(()=>{const r=document.querySelectorAll('.page.is-top .installed-app .cell-inner'); if(r[0]) r[0].click(); return r.length})()"},
 {"wait": 900},
 {"shot": p+"manage"},
]
json.dump(steps, open(f"s-{style}-{app}.json","w"), indent=1)
