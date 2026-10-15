// Captures the prototype screens used in the UX case study.
// Drives design/prototype.html in headless Chrome over the DevTools protocol, no dependencies.
//   node design/ux/shots.mjs            (writes design/ux/shots/*.jpg)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const only = process.argv.slice(2);

// Each shot starts from a fresh page. `steps` runs in the page with the helpers below.
// `focus` lists the elements a close-up should show; their box goes to shots/crops.json.
const SHOTS = [
  { name: 'welcome', steps: `go('welcome')` },
  { name: 'table', steps: `go('table')` },
  { name: 'review', steps: `go('table'); click('#previewSql'); await wait(400)` },
  { name: 'query-target', focus: ['#runBtn', '.popmenu'], steps: `go('query'); click('#runBtn'); await wait(900); click('#qTarget'); await wait(300)` },
  { name: 'gate', focus: ['#gate .gate-in'], pad: 70, steps: `go('mongo'); await wait(300)` },
  { name: 'env-matrix', focus: ['#envScrim .sheet'], steps: `click('[data-open="envs"]'); await wait(200); click('[data-envtab="conns"]'); await wait(300)` },
  { name: 'conn-profile', focus: ['#connForm'], steps: `click('[data-open="envs"]'); await wait(200); click('[data-envtab="conns"]'); await wait(200); click('[data-pedit="acme-db|staging"]'); await wait(400)` },
  { name: 'prod-confirm', focus: ['#confirmForm'], pad: 90, steps: `env('prod'); go('table'); await wait(300); click('#commit'); await wait(300); type('#confirmInput', 'acme-db'); await wait(200)` },
  { name: 'prod-table', steps: `env('prod'); go('table'); await wait(400)` },
  { name: 'coll-menu', focus: ['.popmenu', '.nadd[aria-expanded="true"]'], steps: `go('api'); await wait(200); const f = [...document.querySelectorAll('#collTree .cnode[data-ctype="folder"]')].find(n => !n.closest('.shut')); f.scrollIntoView({ block: 'center' }); await wait(100); f.parentElement.querySelector(':scope > .nadd').click(); await wait(300)` },
  { name: 'import', focus: ['#importScrim .sheet'], steps: `key('i', { metaKey: true, shiftKey: true }); await wait(300); click('[data-impsample="postman"]'); await wait(600)` },
  { name: 'api', steps: `go('api'); click('#sendBtn'); await wait(1200)` },
  { name: 'erd', steps: `go('erd'); await wait(500)` },
  { name: 'mongo', steps: `env('staging'); go('mongo'); await wait(400); $('#toast').hidden = true` },
  { name: 'supabase', steps: `go('supabase'); await wait(400)` },
  { name: 'firebase', steps: `go('firebase'); await wait(400)` },
  { name: 'palette', focus: ['.palette'], steps: `click('[data-open="palette"]'); await wait(200); type('#palInput', 'ord'); await wait(300)` },
  { name: 'settings', steps: `go('settings'); await wait(300)` },
  { name: 'design', steps: `go('design'); await wait(600)` },
  { name: 'query-dark', dark: true, steps: `go('query'); click('#runBtn'); await wait(1200)` },
  { name: 'welcome-dark', dark: true, steps: `go('welcome')` },
];

const HELPERS = `
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => { const el = document.querySelector(s); if (!el) throw new Error('missing ' + s); return el; };
const click = s => $(s).click();
const go = v => { click('#jump [data-go="' + v + '"]'); };
const env = e => click('#envSeg [data-env="' + e + '"]');
const type = (s, text) => { const el = $(s); el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'berth-shots-'));
const PAGE = pathToFileURL(join(HERE, '..', 'prototype.html')).href;
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0;
const pending = new Map(), waiters = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
const once = event => new Promise(r => waiters.push({ event, r }));

async function evaluate(expr) {
  const out = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
  return out.result.value;
}

async function load(dark) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: PAGE });
  await loaded;
  await evaluate(`(async () => { localStorage.clear(); })()`);
  const again = once('Page.loadEventFired');
  await send('Page.reload', { ignoreCache: true });
  await again;
  await evaluate(`document.fonts.ready.then(() => true)`);
}

const CROPS = join(HERE, 'shots', 'crops.json');
const crops = existsSync(CROPS) ? JSON.parse(readFileSync(CROPS, 'utf8')) : {};
try {
  let list;
  for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(200); } }
  const target = list.find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result); }
    else if (m.method) for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].event === m.method) { waiters[i].r(m.params); waiters.splice(i, 1); }
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });

  for (const shot of SHOTS.filter(s => !only.length || only.includes(s.name))) {
    await load(shot.dark);
    await evaluate(`(async () => { ${HELPERS}; ${shot.steps}; await wait(250); })()`);
    const r = await evaluate(`(() => { const b = document.querySelector('#win').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { ...r, scale: 1 } });
    writeFileSync(join(HERE, 'shots', `${shot.name}.jpg`), Buffer.from(data, 'base64'));
    if (shot.focus) crops[shot.name] = await evaluate(`(() => {
      const w = document.querySelector('#win').getBoundingClientRect(), pad = ${shot.pad || 24};
      const bs = ${JSON.stringify(shot.focus)}.map(s => document.querySelector(s)).filter(Boolean).map(e => e.getBoundingClientRect());
      if (!bs.length) throw new Error('no focus element for ${shot.name}');
      const c = (v, max) => Math.min(max, Math.max(0, v));
      const x0 = c(Math.min(...bs.map(b => b.left)) - w.left - pad, w.width), y0 = c(Math.min(...bs.map(b => b.top)) - w.top - pad, w.height);
      const x1 = c(Math.max(...bs.map(b => b.right)) - w.left + pad, w.width), y1 = c(Math.max(...bs.map(b => b.bottom)) - w.top + pad, w.height);
      const r = v => Math.round(v * 1e4) / 1e4;
      return { x: r(x0 / w.width), y: r(y0 / w.height), w: r((x1 - x0) / w.width), h: r((y1 - y0) / w.height), ratio: r(w.width / w.height) };
    })()`);
    console.log(`${shot.name}.jpg  ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  writeFileSync(CROPS, JSON.stringify(crops, null, 2) + '\n');
} finally {
  ws?.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
