// Static checks on design/prototype.html: the scripts compile, every id and icon the code
// references exists, the sample workspace is valid, and the page stays free of risky patterns.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { html, scriptBlock, mainScript, loadCore, loadSample } from './load.mjs';

const H = html();
const MAIN = mainScript();
const C = loadCore();
const S = loadSample();

describe('scripts', () => {
  test('all three script blocks compile', () => {
    for (const [name, code] of [['berth-core', scriptBlock('berth-core')], ['berth-sample', scriptBlock('berth-sample')], ['main', MAIN]]) {
      assert.doesNotThrow(() => new vm.Script(code, { filename: name }), name);
    }
  });
  test('the core runs without any browser globals', () => {
    const ctx = vm.createContext({});
    const core = vm.runInContext(`${scriptBlock('berth-core')}\nBerthCore`, ctx);
    assert.equal(core.routeQuery('SELECT 1', { hasRead: true }).role, 'read');
    assert.equal(core.importText("curl https://a.test").ok, true);
  });
  test('the core loads before the sample, and both load before the main script', () => {
    const a = H.indexOf('<script id="berth-core">'), b = H.indexOf('<script id="berth-sample">'), c = H.indexOf('<script>\n(() => {');
    assert.ok(a > 0 && a < b && b < c);
  });
});

describe('references', () => {
  // ids written literally, plus ids passed to the form helpers FI(cls, id, …), SEL(cls, id, …) and PW(id, …)
  const ids = new Set([...H.matchAll(/\bid="([^"$]+)"/g), ...H.matchAll(/\b(?:FI|SEL)\('[^']*', '([\w-]+)'/g), ...H.matchAll(/\bPW\('([\w-]+)'/g)].map(m => m[1]));
  const symbols = new Set([...H.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
  test('every #id the main script selects exists in the page', () => {
    const used = new Set([...MAIN.matchAll(/(?:\$\$?\(|closest\()['`]#([A-Za-z][\w-]*)/g)].map(m => m[1]));
    const missing = [...used].filter(id => !ids.has(id));
    assert.deepEqual(missing, []);
  });
  test('every icon reference points at a defined symbol', () => {
    const refs = new Set([...H.matchAll(/#(i-[a-z0-9-]+)/g), ...H.matchAll(/'(i-[a-z0-9-]+)'/g)].map(m => m[1]));
    const missing = [...refs].filter(r => !symbols.has(r));
    assert.deepEqual(missing, []);
  });
  test('every overlay listed in OVERLAYS exists', () => {
    const list = /const OVERLAYS = \[([^\]]+)\]/.exec(MAIN)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    assert.ok(list.includes('importScrim'));
    for (const id of list) assert.ok(ids.has(id), id);
  });
});

describe('content', () => {
  test('old per-environment connection names are gone', () => {
    assert.deepEqual(H.match(/pg-(dev|staging|prod)\b|pg-\$\{/g), null);
  });
  test('the API section is called API Collections everywhere', () => {
    assert.match(H, /<span class="gl">API Collections<\/span>/);
    assert.match(MAIN, /label: 'API Collections'/);
    assert.doesNotMatch(H, /<span class="gl">Collections<\/span>/);
  });
  test('the sample SQL in the editor is a read and routes to the read replica', () => {
    const sql = /const SQL = `([\s\S]*?)`;/.exec(MAIN)[1];
    const r = C.routeQuery(sql, { hasRead: true });
    assert.equal(r.kind, 'read');
    assert.equal(r.role, 'read');
  });
});

describe('sample workspace', () => {
  test('every sample profile passes validation', () => {
    for (const c of S.connections) {
      for (const env of C.ENVS) {
        const p = C.profileFor(c, env);
        if (p) assert.deepEqual(C.validateProfile(c.engine, env, C.normalizeProfile(env, p)), [], `${c.id} ${env}`);
      }
    }
  });
  test('production profiles are read-only and dev and staging have separate read databases', () => {
    for (const c of S.connections) { const p = C.profileFor(c, 'prod'); if (p) assert.equal(p.readOnly, true, c.id); }
    const db = S.connections.find(c => c.id === 'acme-db');
    for (const env of ['dev', 'staging']) {
      const p = C.profileFor(db, env);
      assert.notEqual(C.endpoints(p, 'read')[0].database, C.endpoints(p, 'write')[0].database, env);
    }
  });
  test('events-db deliberately has no dev profile', () => {
    assert.deepEqual(C.missingIn(S.connections, 'dev'), ['events-db']);
  });
  test('sample profiles hold keychain references, never secrets', () => {
    const text = JSON.stringify(S.connections);
    assert.doesNotMatch(text, /password|passwd|"pw"/i);
    for (const m of text.matchAll(/"secret":"([^"]*)"/g)) assert.match(m[1], /^keychain:\/\/berth-studio\//);
  });
  test('collection ids are unique and the open list points at real folders', () => {
    const ids = [];
    (function walk(list) { list.forEach(n => { ids.push(n.id); walk(n.children || []); }); })(S.collections);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of S.open) assert.ok(C.isContainer(C.findNode(S.collections, id)), id);
    assert.ok(C.pathTo(S.collections, 'r-adm-revoke').length >= 4, 'the sample shows three levels of folders');
  });
  test('the import samples import cleanly', () => {
    const p = C.importText(JSON.stringify(S.importSamples.postman), 'payments.postman_collection.json');
    assert.equal(p.ok, true);
    assert.deepEqual({ ...p.stats }, { folders: 3, requests: 6, variables: 2, secrets: 3, scripts: 1, blocked: 0 });
    assert.equal(JSON.stringify(p.collection).includes('sk_test_51Hx9aQ2pL5mVw0aRt7y'), false);
    const o = C.importText(JSON.stringify(S.importSamples.openapi));
    assert.deepEqual([o.stats.folders, o.stats.requests], [2, 5]);
    const c = C.importText(S.importSamples.curl);
    assert.deepEqual([c.ok, c.stats.requests, c.stats.secrets], [true, 1, 1]);
  });
});

describe('page safety', () => {
  test('no inline event handlers, remote scripts or network calls', () => {
    assert.doesNotMatch(H, /\son[a-z]+="/);
    assert.doesNotMatch(H, /<script\s+src=/);
    assert.doesNotMatch(H, /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    assert.doesNotMatch(H, /\beval\(|new Function\(/);
  });
  test('menus only flip aria-expanded on real menu buttons, never on tree nodes', () => {
    assert.equal((MAIN.match(/hasAttribute\('aria-haspopup'\)/g) || []).length, 2);
    assert.match(H, /id="collAdd" aria-haspopup="menu"/);
    assert.match(H, /id="qTarget" aria-haspopup="menu"/);
  });
  test('stored state is read through try/catch helpers only', () => {
    const raw = MAIN.match(/localStorage\.(getItem|setItem)/g) || [];
    assert.equal(raw.length, 2, 'only the store helper touches localStorage');
  });
  test('hidden overlays stay hidden when the file is opened directly', () => {
    // .scrim{display:flex} must never beat [hidden], whatever mode the browser renders the page in.
    // A global rule, not one scoped to a single component such as .crow[hidden].
    assert.match(H, /(^|[}\s])\[hidden\]\{display:none!important\}/m);
  });
  test('the Settings secret rows do not restyle secret variable chips', () => {
    // .var.secret chips sit inline in JSON bodies; a bare .secret{display:grid} pushed them onto their own line.
    assert.doesNotMatch(H, /(^|\})\s*\.secret[{:\s]/m);
    assert.match(H, /\.secrets > \.secret\{display:grid/);
  });
});
