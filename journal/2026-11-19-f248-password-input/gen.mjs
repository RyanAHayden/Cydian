// Writes the shots.mjs script for F248's renders: each Password state in the light and dark themes, then a real pick
// of the locked fixture .p12 (does the field end up focused?) and of the one with no password.
//   node gen.mjs <repo root> > script.json
const root = process.argv[2];
const fx = (n) => `${root}/web/app/core/fixtures/signing/${n}`;
const ROUTE = "#/home/settings/signing";
const identity = (file, patch) => ({ eval: `(async()=>{const m=await import('./signing-client.js');await m.clearIdentity();`
  + `const b=new Uint8Array(await (await fetch('./core/fixtures/signing/${file}')).arrayBuffer());`
  + `await m.saveIdentity({p12:b,p12Name:'me.p12',...${JSON.stringify(patch)}});return 'ok'})()` });
const theme = (t) => ({ eval: `import('./screens/settings.js').then(m=>{m.settings.set('appearance','${t}');return '${t}'})` });
const reveal = { eval: "(()=>{const e=document.querySelector('.sign-password');if(!e)return 'no group';e.scrollIntoView({block:'center'});"
  + "return document.querySelector('.sign-pw-cell').dataset.state+' | '+document.querySelector('.sign-pw-status').textContent})()" };
const STATES = {
  waiting: ["test.p12", { passwordOk: false }],
  wrong: ["test.p12", { password: "nope", passwordOk: false }],
  right: ["test.p12", { password: "hunter2", passwordOk: true }],
  notneeded: ["test-nopass.p12", { password: "", passwordOk: true }],
};
const steps = [{ eval: "localStorage.setItem('ifizbox.firstVisit','later');'ok'" }];
for (const t of ["light", "dark"]) {
  steps.push(theme(t));
  for (const [name, [file, patch]] of Object.entries(STATES)) {
    steps.push(identity(file, patch), { nav: ROUTE, ms: 3500 }, reveal, { wait: 300 }, { shot: `${name}-${t}` });
  }
  steps.push({ eval: "import('./signing-client.js').then(async m=>{await m.clearIdentity();return 'cleared'})" }, { nav: ROUTE, ms: 3500 }, reveal, { wait: 300 }, { shot: `empty-${t}` });
}
// real picks through the Certificate group's Import row (its hidden multi-file input)
steps.push(theme("light"), { eval: "import('./signing-client.js').then(async m=>{await m.clearIdentity();return 'cleared'})" }, { nav: ROUTE, ms: 3500 },
  { files: [fx("test.p12")], into: ".sign-import input[type=file]", ms: 4000 },
  { eval: "(()=>{const a=document.activeElement;return (a&&a.className)+' | state '+document.querySelector('.sign-pw-cell')?.dataset.state+' | '+document.querySelector('.sign-pw-status')?.textContent})()" },
  { shot: "pick-locked-light" },
  { eval: "import('./signing-client.js').then(async m=>{await m.clearIdentity();return 'cleared'})" }, { nav: ROUTE, ms: 3500 },
  { files: [fx("test-nopass.p12")], into: ".sign-import input[type=file]", ms: 4000 },
  { eval: "import('./signing-client.js').then(async m=>{const i=await m.loadIdentity();return JSON.stringify({password:i?.password,passwordOk:i?.passwordOk})+' | state '+document.querySelector('.sign-pw-cell')?.dataset.state+' | '+document.querySelector('.sign-pw-status')?.textContent})" },
  reveal, { wait: 300 }, { shot: "pick-nopass-light" });
console.log(JSON.stringify(steps, null, 1));
