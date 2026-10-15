import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();

/* ---------- fixtures ---------- */
const pgProfile = (over = {}) => ({
  endpoints: [
    { role: 'write', host: 'db-w.dev.acme.internal', port: 5432, database: 'acme_dev_write', user: 'app', secret: 'keychain://berth-studio/acme-db/dev/write' },
    { role: 'read', host: 'db-r.dev.acme.internal', port: 5432, database: 'acme_dev_read', user: 'app_ro', secret: 'keychain://berth-studio/acme-db/dev/read' }
  ],
  autoRoute: true,
  ...over
});
const conns = [
  { id: 'acme-db', engine: 'postgres', profiles: { dev: pgProfile(), staging: pgProfile(), prod: pgProfile({ readOnly: true }) } },
  { id: 'events-db', engine: 'mongodb', profiles: { staging: { endpoints: [{ role: 'write', uri: 'mongodb+srv://ro@c0.acme.net/x' }] }, prod: { readOnly: true, endpoints: [{ role: 'write', uri: 'mongodb+srv://ro@c1.acme.net/x' }] } } }
];

describe('connection profiles', () => {
  test('profileFor returns the profile, or null when the environment has none', () => {
    assert.equal(C.profileFor(conns[0], 'dev').endpoints.length, 2);
    assert.equal(C.profileFor(conns[1], 'dev'), null);
    assert.equal(C.profileFor(null, 'dev'), null);
  });
  test('profileFor ignores inherited keys such as toString or __proto__', () => {
    assert.equal(C.profileFor({ profiles: {} }, 'toString'), null);
    assert.equal(C.profileFor({ profiles: {} }, '__proto__'), null);
  });
  test('endpoints filters by role', () => {
    const p = C.profileFor(conns[0], 'dev');
    assert.deepEqual(C.endpoints(p, 'write').map(e => e.host), ['db-w.dev.acme.internal']);
    assert.deepEqual(C.endpoints(p, 'read').map(e => e.host), ['db-r.dev.acme.internal']);
    assert.equal(C.endpoints(null, 'read').length, 0);
  });
  test('coverage, missingIn and firstProfileEnv describe which environments exist', () => {
    assert.deepEqual(C.coverage(conns[1]), [{ env: 'dev', on: false }, { env: 'staging', on: true }, { env: 'prod', on: true }]);
    assert.deepEqual(C.missingIn(conns, 'dev'), ['events-db']);
    assert.deepEqual(C.missingIn(conns, 'dev', c => c.engine !== 'mongodb'), []);
    assert.deepEqual(C.missingIn(conns, 'staging'), []);
    assert.equal(C.firstProfileEnv(conns[1]), 'staging');
    assert.equal(C.firstProfileEnv({ profiles: {} }), null);
  });
  test('normalizeProfile forces read-only in prod and leaves the input untouched', () => {
    const src = pgProfile({ readOnly: false });
    assert.equal(C.normalizeProfile('prod', src).readOnly, true);
    assert.equal(C.normalizeProfile('dev', src).readOnly, false);
    assert.equal(src.readOnly, false);
  });
});

describe('validateProfile', () => {
  test('a complete Postgres profile with a separate read database is valid', () => {
    assert.deepEqual(C.validateProfile('postgres', 'dev', pgProfile()), []);
  });
  test('needs exactly one write endpoint', () => {
    const none = pgProfile(); none.endpoints = none.endpoints.filter(e => e.role === 'read');
    assert.match(C.validateProfile('postgres', 'dev', none).join(' '), /exactly one primary/);
    const two = pgProfile(); two.endpoints.push({ ...two.endpoints[0], host: 'other.acme.internal' });
    assert.match(C.validateProfile('postgres', 'dev', two).join(' '), /exactly one primary/);
  });
  test('rejects bad ports, bad hosts and empty fields', () => {
    for (const port of [0, 70000, 'abc', 5432.5]) {
      const p = pgProfile(); p.endpoints[0].port = port;
      assert.match(C.validateProfile('postgres', 'dev', p).join(' '), /port must be between 1 and 65535/, `port ${port}`);
    }
    const h = pgProfile(); h.endpoints[1].host = 'db_dev!.acme';
    assert.match(C.validateProfile('postgres', 'dev', h).join(' '), /Read replica 1: "db_dev!\.acme" is not a valid host name/);
    const e = pgProfile(); e.endpoints[0].database = ' '; e.endpoints[0].user = '';
    const errs = C.validateProfile('postgres', 'dev', e).join(' ');
    assert.match(errs, /database is empty/);
    assert.match(errs, /user is empty/);
  });
  test('accepts IPv4, IPv6 and localhost hosts', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '::1', 'fd00::5']) {
      const p = pgProfile(); p.endpoints[0].host = host;
      assert.deepEqual(C.validateProfile('postgres', 'dev', p), [], host);
    }
  });
  test('flags a read endpoint that is the same as the write endpoint', () => {
    const p = pgProfile(); p.endpoints[1] = { ...p.endpoints[0], role: 'read', host: 'DB-W.dev.acme.internal' };
    assert.match(C.validateProfile('postgres', 'dev', p).join(' '), /identical to the primary/);
  });
  test('production must stay read-only', () => {
    assert.match(C.validateProfile('postgres', 'prod', pgProfile({ readOnly: false })).join(' '), /always open read-only/);
    assert.deepEqual(C.validateProfile('postgres', 'prod', pgProfile({ readOnly: true })), []);
  });
  test('MongoDB connection strings never carry a password', () => {
    const p = uri => ({ endpoints: [{ role: 'write', uri }] });
    assert.deepEqual(C.validateProfile('mongodb', 'dev', p('mongodb+srv://ro@cluster0.acme.net/db')), []);
    assert.match(C.validateProfile('mongodb', 'dev', p('mongodb://ro:hunter2@cluster0.acme.net/db')).join(' '), /Remove the password/);
    assert.match(C.validateProfile('mongodb', 'dev', p('postgres://x')).join(' '), /must start with mongodb/);
  });
  test('Supabase and Firebase identifiers are checked', () => {
    assert.deepEqual(C.validateProfile('supabase', 'dev', { ref: 'kqpzvtlmwxrbnhgcdfya', pooler: 'session' }), []);
    assert.equal(C.validateProfile('supabase', 'dev', { ref: 'short', pooler: 'nope' }).length, 2);
    assert.deepEqual(C.validateProfile('firebase', 'dev', { projectId: 'acme-mobile-dev' }), []);
    assert.equal(C.validateProfile('firebase', 'dev', { projectId: 'Bad_ID' }).length, 1);
  });
});

describe('copying a profile to another environment', () => {
  test('swapEnvToken swaps whole environment words only', () => {
    assert.deepEqual(C.swapEnvToken('db.dev.acme.internal', 'dev', 'staging'), { value: 'db.staging.acme.internal', n: 1 });
    assert.equal(C.swapEnvToken('acme_dev_write', 'dev', 'staging').value, 'acme_staging_write');
    assert.equal(C.swapEnvToken('devices.acme.io', 'dev', 'prod').value, 'devices.acme.io');
    assert.equal(C.swapEnvToken('devops-db', 'dev', 'prod').value, 'devops-db');
    assert.equal(C.swapEnvToken('db.staging.acme.io', 'staging', 'dev').value, 'db.dev.acme.io');
    assert.equal(C.swapEnvToken('api-stg-1.acme.io', 'staging', 'prod').value, 'api-prd-1.acme.io');
    assert.equal(C.swapEnvToken('production-db', 'prod', 'dev').value, 'development-db');
    assert.deepEqual(C.swapEnvToken('db.dev.io', 'dev', 'dev'), { value: 'db.dev.io', n: 0 });
  });
  test('cloneProfile renames hosts, drops secrets and keeps the source intact', () => {
    const src = pgProfile();
    const { profile, replaced } = C.cloneProfile(src, 'dev', 'staging');
    assert.equal(replaced, 4);
    assert.deepEqual(profile.endpoints.map(e => e.host), ['db-w.staging.acme.internal', 'db-r.staging.acme.internal']);
    assert.deepEqual(profile.endpoints.map(e => e.database), ['acme_staging_write', 'acme_staging_read']);
    assert.ok(profile.endpoints.every(e => e.secret === null && e.needsSecret === true));
    assert.equal(profile.copiedFrom, 'dev');
    assert.equal(src.endpoints[0].secret, 'keychain://berth-studio/acme-db/dev/write');
    assert.equal(JSON.stringify(profile).includes('keychain://'), false);
  });
  test('a copy into prod is read-only, and a Supabase ref is never guessed', () => {
    assert.equal(C.cloneProfile(pgProfile(), 'dev', 'prod').profile.readOnly, true);
    assert.equal(C.cloneProfile({ ref: 'kqpzvtlmwxrbnhgcdfya', pooler: 'session' }, 'dev', 'prod').profile.ref, '');
  });
});

describe('read/write routing', () => {
  const kind = sql => C.classifySql(sql).kind;
  test('plain reads go to read', () => {
    for (const sql of ['SELECT 1', 'select * from users where id = $1', 'TABLE users', 'VALUES (1), (2)', 'SHOW search_path',
      'WITH a AS (SELECT 1) SELECT * FROM a', 'SELECT update_count, nextval_total FROM stats', 'EXPLAIN SELECT * FROM t',
      'EXPLAIN UPDATE users SET x = 1', 'EXPLAIN ANALYZE SELECT * FROM t']) {
      assert.equal(kind(sql), 'read', sql);
    }
  });
  test('writes, locks, DDL and session commands go to write', () => {
    for (const sql of ['INSERT INTO t VALUES (1)', 'update users set plan = $1', 'DELETE FROM t', 'MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE',
      'TRUNCATE t', 'CREATE TABLE x (id int)', 'ALTER TABLE x ADD c int', 'DROP TABLE x', 'BEGIN', 'SET statement_timeout = 0', 'VACUUM',
      'SELECT * FROM t FOR UPDATE', 'SELECT * FROM t FOR NO KEY UPDATE', 'SELECT * FROM t FOR SHARE', 'SELECT * FROM t FOR KEY SHARE',
      'SELECT * INTO backup FROM t', "SELECT nextval('users_id_seq')", "SELECT pg_advisory_lock(42)", "SELECT set_config('x', 'y', false)",
      'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'EXPLAIN ANALYZE UPDATE t SET x = 1', 'EXPLAIN (ANALYZE, BUFFERS) DELETE FROM t',
      'COPY t FROM STDIN', 'CALL refresh_all()', 'DO $$ BEGIN END $$']) {
      assert.equal(kind(sql), 'write', sql);
    }
  });
  test('keywords inside strings, identifiers and comments never count', () => {
    for (const sql of ["SELECT 'DELETE FROM users'", "SELECT 'it''s; DROP TABLE x'", "SELECT E'it\\'s; DELETE FROM x'",
      'SELECT $$ UPDATE t SET x = 1 $$', 'SELECT $body$ DROP TABLE t; $body$', 'SELECT "update" FROM t', '-- DELETE FROM t\nSELECT 1',
      '/* outer /* nested */ DROP TABLE t */ SELECT 1']) {
      assert.equal(kind(sql), 'read', sql);
    }
  });
  test('a script with any write is a write, and empty input is empty', () => {
    assert.deepEqual({ ...C.classifySql('SELECT 1; DELETE FROM t;') , reason: undefined }, { kind: 'write', statements: 2, reason: undefined });
    assert.equal(kind('  ;  -- only a comment\n'), 'empty');
    assert.equal(kind(''), 'empty');
  });
  test('stripSql keeps code and blanks out literals', () => {
    assert.equal(C.stripSql("SELECT 'a;b' -- c\n, 1").replace(/\s+/g, ' ').trim(), "SELECT '' , 1");
  });
  test('routeQuery uses read only when it is safe', () => {
    assert.equal(C.routeQuery('SELECT 1', { hasRead: true }).role, 'read');
    assert.equal(C.routeQuery('SELECT 1', { hasRead: false }).role, 'write');
    assert.equal(C.routeQuery('SELECT 1', { hasRead: true, inTransaction: true }).role, 'write');
    const w = C.routeQuery('UPDATE t SET x = 1', { hasRead: true });
    assert.equal(w.role, 'write');
    assert.match(w.reason, /UPDATE/);
    assert.equal(C.routeQuery('', { hasRead: true }).role, 'write');
  });
  test('routeQuery honours a pinned endpoint and warns about writes pinned to read', () => {
    assert.equal(C.routeQuery('SELECT 1', { mode: 'write', hasRead: true }).role, 'write');
    const r = C.routeQuery('DELETE FROM t', { mode: 'read', hasRead: true });
    assert.equal(r.role, 'read');
    assert.match(r.warn, /will reject it/);
    assert.equal(C.routeQuery('SELECT 1', { mode: 'read', hasRead: false }).role, 'write');
  });
});

/* ---------- collections tree ---------- */
const tree = () => ([
  { id: 'c1', type: 'collection', name: 'auth-service', children: [
    { id: 'r1', type: 'request', name: '/auth/login', method: 'POST', url: '{{API_HOST}}/v1/auth/login' },
    { id: 'f1', type: 'folder', name: 'sessions', children: [
      { id: 'r2', type: 'request', name: '/auth/refresh', method: 'POST', url: '{{API_HOST}}/v1/auth/refresh' },
      { id: 'f2', type: 'folder', name: 'admin', children: [
        { id: 'r3', type: 'request', name: 'Revoke session', method: 'DELETE', url: '{{API_HOST}}/v1/admin/sessions/:id' }
      ] }
    ] }
  ] },
  { id: 'c2', type: 'collection', name: 'orders-api', children: [
    { id: 'f3', type: 'folder', name: 'refunds', children: [{ id: 'r4', type: 'request', name: 'Create refund', method: 'POST', url: '/refunds' }] }
  ] }
]);

describe('names', () => {
  test('validateName trims, collapses spaces and strips control characters', () => {
    assert.deepEqual(C.validateName('  New \t folder\u0007 '), { ok: true, name: 'New folder' });
    assert.deepEqual(C.validateName('/auth/login'), { ok: true, name: '/auth/login' });
  });
  test('validateName rejects empty, reserved and overlong names', () => {
    assert.equal(C.validateName('   ').ok, false);
    assert.equal(C.validateName('..').ok, false);
    assert.equal(C.validateName('.').ok, false);
    assert.equal(C.validateName('x'.repeat(81)).ok, false);
    assert.equal(C.validateName('x'.repeat(80)).ok, true);
  });
  test('fileName can never escape the workspace folder', () => {
    for (const raw of ['../../etc/passwd', '..\\..\\Windows\\system32', '/abs/path', '.hidden', 'a/../../b']) {
      const f = C.fileName(raw);
      assert.ok(!/[\\/]/.test(f), `${raw} -> ${f}`);
      assert.ok(!f.startsWith('.'), `${raw} -> ${f}`);
    }
    assert.equal(C.fileName('a:b*c?d'), 'a-b-c-d');
    assert.equal(C.fileName('CON'), '_CON');
    assert.equal(C.fileName('lpt1.txt'), '_lpt1.txt');
    assert.equal(C.fileName('...'), 'untitled');
    assert.equal(C.fileName(''), 'untitled');
    assert.equal(C.fileName('GET /orders'), 'GET -orders');
  });
  test('uniqueName adds a number, ignoring case and the item being renamed', () => {
    const sib = [{ id: 'a', name: 'New folder' }, { id: 'b', name: 'new folder 2' }];
    assert.equal(C.uniqueName(sib, 'New folder'), 'New folder 3');
    assert.equal(C.uniqueName(sib, 'Other'), 'Other');
    assert.equal(C.uniqueName(sib, 'New folder', 'a'), 'New folder');
  });
});

describe('tree operations', () => {
  test('findNode and pathTo walk any depth', () => {
    assert.equal(C.findNode(tree(), 'r3').name, 'Revoke session');
    assert.deepEqual(C.pathTo(tree(), 'r3').map(n => n.id), ['c1', 'f1', 'f2', 'r3']);
    assert.equal(C.findNode(tree(), 'zzz'), null);
    assert.equal(C.pathTo(tree(), 'zzz'), null);
  });
  test('insertNode adds a folder inside a folder without mutating the input', () => {
    const t = tree();
    const { tree: t2, node } = C.insertNode(t, 'f2', { type: 'folder', name: 'New folder' });
    assert.equal(C.findNode(t2, 'f2').children.at(-1).id, node.id);
    assert.deepEqual(node.children, []);
    assert.equal(C.findNode(t, 'f2').children.length, 1);
    const again = C.insertNode(t2, 'f2', { type: 'folder', name: 'new folder' });
    assert.equal(again.node.name, 'new folder 2');
  });
  test('insertNode places a node at an index and gives it an id', () => {
    const { tree: t2, node } = C.insertNode(tree(), 'c1', { type: 'request', name: 'First', method: 'GET' }, 0);
    assert.equal(C.findNode(t2, 'c1').children[0].id, node.id);
    assert.ok(node.id);
  });
  test('insertNode refuses impossible places', () => {
    assert.throws(() => C.insertNode(tree(), 'r1', { type: 'folder', name: 'x' }), /Requests cannot hold/);
    assert.throws(() => C.insertNode(tree(), null, { type: 'folder', name: 'x' }), /Only a collection/);
    assert.throws(() => C.insertNode(tree(), 'gone', { type: 'folder', name: 'x' }), /no longer exists/);
  });
  test('a collection inserted under a folder becomes a folder', () => {
    const { node } = C.insertNode(tree(), 'f1', { type: 'collection', name: 'nested', children: [] });
    assert.equal(node.type, 'folder');
  });
  test('removeNode returns what undo needs', () => {
    const r = C.removeNode(tree(), 'f2');
    assert.equal(r.removed.id, 'f2');
    assert.equal(r.parentId, 'f1');
    assert.equal(r.index, 1);
    assert.equal(C.findNode(r.tree, 'r3'), null);
    const back = C.insertNode(r.tree, r.parentId, r.removed, r.index).tree;
    assert.deepEqual(back, tree());
    assert.equal(C.removeNode(tree(), 'nope').removed, null);
  });
  test('removeNode can remove a top-level collection', () => {
    const r = C.removeNode(tree(), 'c2');
    assert.equal(r.parentId, null);
    assert.equal(r.tree.length, 1);
  });
  test('renameNode validates and keeps sibling names unique', () => {
    const ok = C.renameNode(tree(), 'f1', '  auth sessions ');
    assert.equal(ok.ok, true);
    assert.equal(C.findNode(ok.tree, 'f1').name, 'auth sessions');
    assert.match(C.renameNode(tree(), 'f1', '/AUTH/LOGIN').error, /already uses that name/);
    assert.equal(C.renameNode(tree(), 'f1', 'sessions').ok, true);
    assert.equal(C.renameNode(tree(), 'f1', '').ok, false);
    assert.equal(C.renameNode(tree(), 'gone', 'x').ok, false);
  });
  test('countTree, flatRequests and containers summarise the tree', () => {
    assert.deepEqual(C.countTree(tree()), { collections: 2, folders: 3, requests: 4 });
    assert.deepEqual(C.flatRequests(tree()).find(r => r.node.id === 'r3').trail, ['auth-service', 'sessions', 'admin']);
    assert.deepEqual(C.containers(tree()).map(c => [c.label, c.depth]), [
      ['auth-service', 0], ['auth-service / sessions', 1], ['auth-service / sessions / admin', 2], ['orders-api', 0], ['orders-api / refunds', 1]
    ]);
  });
  test('matchIds keeps ancestors of matches and the contents of matching folders', () => {
    assert.equal(C.matchIds(tree(), '  '), null);
    assert.deepEqual([...C.matchIds(tree(), 'revoke')].sort(), ['c1', 'f1', 'f2', 'r3']);
    assert.deepEqual([...C.matchIds(tree(), 'SESSIONS')].sort(), ['c1', 'f1', 'f2', 'r2', 'r3']);
    assert.deepEqual([...C.matchIds(tree(), 'delete')].sort(), ['c1', 'f1', 'f2', 'r3']);
    assert.equal(C.matchIds(tree(), 'zzz').size, 0);
  });
});

describe('treeHtml', () => {
  test('renders nesting depth, open state and the add button', () => {
    const h = C.treeHtml(tree(), { open: new Set(['c1', 'f1']) });
    assert.match(h, /data-cid="r3"[^>]*style|style="--d:3" data-cid="r3"/);
    assert.match(h, /data-cid="f1" data-ctype="folder" role="treeitem" aria-level="2" aria-expanded="true"/);
    assert.match(h, /data-cid="f2" data-ctype="folder" role="treeitem" aria-level="3" aria-expanded="false"/);
    assert.match(h, /class="kids shut" style="--d:2" data-kids="f2"/);
    assert.match(h, /data-cadd="f1" aria-haspopup="menu"/);
    assert.doesNotMatch(h, /data-cadd="r1"/);
    assert.doesNotMatch(C.treeHtml(tree(), { editable: false }), /data-cadd/);
  });
  test('escapes every name, id and URL', () => {
    const evil = [{ id: 'x"><script>', type: 'collection', name: '<img src=x onerror=alert(1)>', children: [
      { id: 'y', type: 'request', name: "'\"><b>", method: '<svg onload=1>', url: 'javascript:alert(1)"' }
    ] }];
    const h = C.treeHtml(evil, { open: new Set(['x"><script>']) });
    assert.doesNotMatch(h, /<img|<script|<b>|<svg onload/);
    assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(h, /<span class="meth GET">GET<\/span>/);
  });
  test('a valid but uncommon method keeps its name without a colour class', () => {
    const h = C.treeHtml([{ id: 'q', type: 'request', name: 'find', method: 'propfind', url: '/dav' }]);
    assert.match(h, /<span class="meth ">PROPFIND<\/span>/);
  });
});

/* ---------- import ---------- */
const postman = () => ({
  info: { name: 'Payments API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: 'col-level-token-123', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'https://api.pay.test' }, { key: 'clientSecret', value: 'cs_live_abc' }, { key: 'apiToken', value: '{{fromEnv}}' }],
  item: [
    { name: 'charges', item: [
      { name: 'Create charge', event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("t", Date.now())'] } }, { listen: 'test', script: { exec: ['pm.test("ok", () => {})'] } }],
        request: { method: 'POST', url: { raw: '{{baseUrl}}/charges?api_key=sk_test_42&limit=5' }, header: [{ key: 'Authorization', value: 'Bearer sk_live_secret' }, { key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: '{"amount": 500}' } } },
      { name: 'refunds', item: [
        { name: 'Refund', request: { method: 'post', url: '{{baseUrl}}/refunds', header: [{ key: 'X-API-Key', value: '{{API_KEY}}' }], auth: { type: 'basic', basic: [{ key: 'username', value: 'ops' }, { key: 'password', value: 'p@ss' }] } } },
        { name: 'deep', item: [{ name: 'List', request: { method: 'GET', url: '{{baseUrl}}/refunds' } }] }
      ] }
    ] },
    { name: 'Health', request: 'https://api.pay.test/health' }
  ]
});
const allText = col => JSON.stringify(col);

describe('detectFormat', () => {
  test('recognises every supported format', () => {
    const J = o => JSON.stringify(o);
    const cases = [
      [J(postman()), 'postman21'],
      [J({ info: { schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' }, item: [] }), 'postman20'],
      [J({ _type: 'export', __export_format: 4, resources: [] }), 'insomnia4'],
      [J({ openapi: '3.1.0', info: {}, paths: {} }), 'openapi3'],
      ['openapi: "3.0.3"\ninfo:\n  title: x\npaths: {}', 'openapi3'],
      [J({ swagger: '2.0', paths: {} }), 'swagger2'],
      [J({ log: { entries: [] } }), 'har'],
      ["curl -X POST 'https://x.test'", 'curl'],
      ['type: collection.insomnia.rest/5.0\nname: x', 'insomnia5'],
      ['meta {\n  name: Login\n}', 'bruno'],
      ['﻿' + J({ log: { entries: [] } }), 'har']
    ];
    for (const [text, id] of cases) assert.equal(C.detectFormat(text)?.id, id, text.slice(0, 40));
    assert.equal(C.detectFormat('anything', 'login.bru').id, 'bruno');
  });
  test('returns null for unknown or broken input', () => {
    assert.equal(C.detectFormat('{"hello": 1}'), null);
    assert.equal(C.detectFormat('{broken'), null);
    assert.equal(C.detectFormat('[1,2]'), null);
    assert.equal(C.detectFormat('just text'), null);
  });
});

describe('cURL parsing', () => {
  test('shellWords handles quotes, escapes and line continuations', () => {
    assert.deepEqual(C.shellWords(`curl -H 'A: b c' "x\\"y" a\\ b \\\n --data $'l1\\nl2'`), ['curl', '-H', 'A: b c', 'x"y', 'a b', '--data', 'l1\nl2']);
  });
  test('infers the method and reads headers and body', () => {
    const c = C.parseCurl(`curl 'https://api.test/v1/users?x=1' -H 'Content-Type: application/json' -H 'Authorization: Bearer abc' --data-raw '{"a":1}'`);
    assert.equal(c.method, 'POST');
    assert.equal(c.url, 'https://api.test/v1/users?x=1');
    assert.deepEqual(c.headers, [{ k: 'Content-Type', v: 'application/json' }, { k: 'Authorization', v: 'Bearer abc' }]);
    assert.equal(c.body, '{"a":1}');
  });
  test('supports -X, -XPOST, --url=, -G, -I, --json, -u and -k', () => {
    assert.equal(C.parseCurl('curl -X put https://a.test').method, 'PUT');
    assert.equal(C.parseCurl('curl -XDELETE https://a.test').method, 'DELETE');
    assert.equal(C.parseCurl('curl --url=https://a.test/x').url, 'https://a.test/x');
    const g = C.parseCurl('curl -G https://a.test/s -d q=1 -d page=2');
    assert.equal(g.method, 'GET'); assert.equal(g.url, 'https://a.test/s?q=1&page=2'); assert.equal(g.body, '');
    assert.equal(C.parseCurl('curl -I https://a.test').method, 'HEAD');
    const j = C.parseCurl(`curl --json '{"a":1}' https://a.test`);
    assert.equal(j.method, 'POST'); assert.deepEqual(j.headers, [{ k: 'Content-Type', v: 'application/json' }]);
    assert.deepEqual(C.parseCurl('curl -u ops:p@ss:word https://a.test').auth, { type: 'basic', username: 'ops', password: 'p@ss:word' });
    assert.equal(C.parseCurl('curl -sSLk https://a.test').insecure, false);
    assert.equal(C.parseCurl('curl -k https://a.test').insecure, true);
    assert.equal(C.parseCurl('curl -o out.json https://a.test').url, 'https://a.test');
  });
  test('rejects input that is not a usable cURL command', () => {
    assert.throws(() => C.parseCurl('wget https://a.test'), /starts with curl/);
    assert.throws(() => C.parseCurl('curl -H "A: b"'), /no URL/);
  });
});

describe('importText', () => {
  test('imports a nested Postman collection', () => {
    const r = C.importText(JSON.stringify(postman()), 'payments.postman_collection.json');
    assert.equal(r.ok, true);
    assert.equal(r.format.label, 'Postman v2.1');
    assert.deepEqual(r.stats, { folders: 3, requests: 4, variables: 3, secrets: 5, scripts: 1, blocked: 0 });
    const col = r.collection;
    assert.equal(col.type, 'collection');
    assert.equal(col.name, 'Payments API');
    assert.deepEqual(C.pathTo([col], C.flatRequests([col]).find(x => x.node.name === 'List').node.id).map(n => n.name), ['Payments API', 'charges', 'refunds', 'deep', 'List']);
    const refund = C.flatRequests([col]).find(x => x.node.name === 'Refund').node;
    assert.equal(refund.method, 'POST');
    assert.equal(C.flatRequests([col]).find(x => x.node.name === 'Health').node.url, 'https://api.pay.test/health');
  });
  test('moves secrets out of the collection and leaves variables behind', () => {
    const r = C.importText(JSON.stringify(postman()));
    const text = allText(r.collection);
    for (const secret of ['col-level-token-123', 'sk_live_secret', 'sk_test_42', 'p@ss', 'cs_live_abc']) {
      assert.equal(text.includes(secret), false, `${secret} leaked into the collection`);
      assert.ok(r.secrets.some(s => s.value === secret), `${secret} missing from the keychain list`);
    }
    const charge = C.flatRequests([r.collection]).find(x => x.node.name === 'Create charge').node;
    assert.equal(charge.headers[0].v, 'Bearer {{PAYMENTS_API_AUTHORIZATION_BEARER}}');
    assert.equal(charge.url, '{{baseUrl}}/charges?api_key={{PAYMENTS_API_API_KEY}}&limit=5');
    assert.equal(C.flatRequests([r.collection]).find(x => x.node.name === 'Refund').node.headers[0].v, '{{API_KEY}}');
    assert.equal(r.collection.variables.find(v => v.k === 'apiToken').v, '{{fromEnv}}');
    assert.equal(new Set(r.secrets.map(s => s.name)).size, r.secrets.length);
  });
  test('the same secret used in several requests becomes one keychain entry', () => {
    const p = postman();
    p.item.push({ name: 'Again', request: { method: 'GET', url: '{{baseUrl}}/again', header: [{ key: 'Authorization', value: 'Bearer sk_live_secret' }] } });
    const r = C.importText(JSON.stringify(p));
    const bearer = r.secrets.filter(s => s.value === 'sk_live_secret');
    assert.equal(bearer.length, 1);
    assert.equal(bearer[0].uses, 2);
    assert.equal(C.flatRequests([r.collection]).find(x => x.node.name === 'Again').node.headers[0].v, 'Bearer {{PAYMENTS_API_AUTHORIZATION_BEARER}}');
  });
  test('keeps secrets in place only when asked to', () => {
    const r = C.importText(JSON.stringify(postman()), '', { moveSecrets: false });
    assert.equal(r.stats.secrets, 0);
    assert.ok(allText(r.collection).includes('sk_live_secret'));
  });
  test('imported scripts are kept disabled, or dropped', () => {
    const kept = C.flatRequests([C.importText(JSON.stringify(postman())).collection]).find(x => x.node.name === 'Create charge').node;
    assert.equal(kept.scriptsEnabled, false);
    assert.match(kept.scripts.pre, /pm\.environment/);
    const dropped = C.flatRequests([C.importText(JSON.stringify(postman()), '', { keepScripts: false }).collection]).find(x => x.node.name === 'Create charge').node;
    assert.equal(dropped.scripts, undefined);
  });
  test('every imported node gets a unique id', () => {
    const ids = [];
    (function walk(n) { ids.push(n.id); (n.children || []).forEach(walk); })(C.importText(JSON.stringify(postman())).collection);
    assert.equal(new Set(ids).size, ids.length);
  });
  test('Insomnia v4 export keeps its folder structure, environment and auth', () => {
    const ins = { _type: 'export', __export_format: 4, resources: [
      { _id: 'wrk_1', _type: 'workspace', name: 'Shop' },
      { _id: 'env_1', _type: 'environment', parentId: 'wrk_1', data: { base_url: 'https://shop.test', nested: { a: 1 } } },
      { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: 'cart' },
      { _id: 'fld_2', _type: 'request_group', parentId: 'fld_1', name: 'items' },
      { _id: 'req_1', _type: 'request', parentId: 'fld_2', name: 'Add item', method: 'POST', url: '{{ _.base_url }}/cart/items', headers: [{ name: 'X-Trace', value: '1' }], authentication: { type: 'bearer', token: 'tok_live' }, body: { text: '{}' } },
      { _id: 'req_2', _type: 'request', parentId: 'missing', name: 'Orphan', method: 'GET', url: 'https://shop.test/o' },
      { _id: 'fld_a', _type: 'request_group', parentId: 'fld_b', name: 'loop a' },
      { _id: 'fld_b', _type: 'request_group', parentId: 'fld_a', name: 'loop b' }
    ] };
    const r = C.importText(JSON.stringify(ins));
    assert.equal(r.ok, true);
    assert.equal(r.collection.name, 'Shop');
    assert.deepEqual(r.collection.variables, [{ k: 'base_url', v: 'https://shop.test' }]);
    const add = C.flatRequests([r.collection]).find(x => x.node.name === 'Add item');
    assert.deepEqual(add.trail, ['Shop', 'cart', 'items']);
    assert.equal(add.node.auth.token, '{{SHOP_TOKEN}}');
    assert.ok(r.warnings.some(w => /no parent folder/.test(w)));
    assert.ok(C.flatRequests([r.collection]).some(x => x.node.name === 'Orphan'));
  });
  test('OpenAPI paths become requests grouped by tag', () => {
    const api = { openapi: '3.0.3', info: { title: 'Petstore' }, servers: [{ url: 'https://pets.test/v1' }],
      components: { securitySchemes: { jwt: { type: 'http', scheme: 'bearer' } } },
      paths: { '/pets': { get: { tags: ['pets'], summary: 'List pets' }, post: { tags: ['pets'], summary: 'Create pet', requestBody: {} } }, '/stores/{id}': { delete: { operationId: 'deleteStore' } } } };
    const r = C.importText(JSON.stringify(api));
    assert.equal(r.ok, true);
    assert.deepEqual(r.collection.variables, [{ k: 'baseUrl', v: 'https://pets.test/v1' }, { k: 'token', v: '' }]);
    assert.deepEqual(r.collection.children.map(f => f.name), ['pets', 'stores']);
    const create = C.flatRequests([r.collection]).find(x => x.node.name === 'Create pet').node;
    assert.equal(create.url, '{{baseUrl}}/pets');
    assert.deepEqual(create.headers, [{ k: 'Authorization', v: 'Bearer {{token}}', off: false }, { k: 'Content-Type', v: 'application/json', off: false }]);
    assert.equal(r.stats.secrets, 0);
    assert.equal(C.flatRequests([r.collection]).find(x => x.node.method === 'DELETE').node.name, 'deleteStore');
  });
  test('Swagger 2.0 builds the base URL from host and basePath', () => {
    const r = C.importText(JSON.stringify({ swagger: '2.0', info: { title: 'Old' }, host: 'old.test', basePath: '/api', schemes: ['https'], paths: { '/a': { get: {} } } }));
    assert.equal(r.collection.variables[0].v, 'https://old.test/api');
    assert.equal(r.stats.requests, 1);
  });
  test('HAR entries are grouped by host and cookies are moved to the keychain', () => {
    const har = { log: { creator: { name: 'Chrome' }, entries: [
      { request: { method: 'GET', url: 'https://a.test/x?y=1', headers: [{ name: ':authority', value: 'a.test' }, { name: 'Cookie', value: 'sid=abc123' }] } },
      { request: { method: 'POST', url: 'https://b.test/login', headers: [], postData: { text: 'u=1' } } }
    ] } };
    const r = C.importText(JSON.stringify(har));
    assert.deepEqual(r.collection.children.map(f => f.name), ['a.test', 'b.test']);
    const x = r.collection.children[0].children[0];
    assert.equal(x.name, 'GET /x');
    assert.deepEqual(x.headers.map(h => h.k), ['Cookie']);
    assert.equal(allText(r.collection).includes('abc123'), false);
  });
  test('a cURL command becomes a one-request collection with its password moved', () => {
    const r = C.importText("curl -u ops:hunter2 -X PATCH 'https://api.shop.test/v1/orders/42' -d status=paid");
    assert.equal(r.ok, true);
    assert.equal(r.collection.name, 'api.shop.test');
    const req = r.collection.children[0];
    assert.equal(req.method, 'PATCH');
    assert.equal(req.name, 'PATCH /v1/orders/42');
    assert.equal(allText(r.collection).includes('hunter2'), false);
    assert.equal(r.secrets[0].value, 'hunter2');
  });
  test('formats that need the desktop app say so', () => {
    const y = C.importText('openapi: 3.0.0\npaths: {}');
    assert.equal(y.ok, false); assert.equal(y.format.label, 'OpenAPI 3.x'); assert.match(y.error, /YAML/);
    assert.match(C.importText('meta {\n name: a\n}').error, /folder of \.bru files/);
    assert.match(C.importText('{"x":1}').error, /does not recognise/);
    assert.match(C.importText('   ').error, /Drop a file/);
  });
});

describe('import safety', () => {
  test('non-HTTP URLs are blocked', () => {
    const p = postman();
    p.item.push({ name: 'local file', request: { method: 'GET', url: 'file:///etc/passwd' } }, { name: 'js', request: { method: 'GET', url: 'javascript:alert(1)' } });
    const r = C.importText(JSON.stringify(p));
    assert.equal(r.stats.blocked, 2);
    assert.equal(r.warnings.filter(w => /is blocked/.test(w)).length, 2);
    assert.equal(C.urlCheck('{{baseUrl}}/x').ok, true);
    assert.equal(C.urlCheck('HTTPS://a.test').ok, true);
    assert.equal(C.urlCheck('/relative').ok, true);
    assert.deepEqual(C.urlCheck('ftp://a.test'), { ok: false, scheme: 'ftp' });
  });
  test('__proto__ keys cannot pollute Object.prototype', () => {
    const text = '{"info":{"name":"x","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json","__proto__":{"polluted":true}},"__proto__":{"polluted":true},"item":[{"name":"a","__proto__":{"polluted":true},"request":{"method":"GET","url":"https://a.test","header":[{"key":"__proto__","value":"x"}]}}]}';
    const r = C.importText(text);
    assert.equal(r.ok, true);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });
  test('control characters and odd methods are cleaned', () => {
    const p = postman();
    p.item = [{ name: 'evil\u0000\u001bname', request: { method: '<script>', url: 'https://a.test' } }];
    const req = C.importText(JSON.stringify(p)).collection.children[0];
    assert.equal(req.name, 'evilname');
    assert.equal(req.method, 'GET');
  });
  test('deep nesting, huge files and too many items are refused', () => {
    let item = [{ name: 'leaf', request: 'https://a.test' }];
    for (let i = 0; i < 30; i++) item = [{ name: `f${i}`, item }];
    const p = postman(); p.item = item;
    assert.match(C.importText(JSON.stringify(p)).error, /nested deeper/);
    const many = postman(); many.item = Array.from({ length: C.LIMITS.items + 1 }, (_, i) => ({ name: `r${i}`, request: 'https://a.test' }));
    assert.match(C.importText(JSON.stringify(many)).error, /more than 5000 items/);
    assert.match(C.importText('{' + ' '.repeat(C.LIMITS.bytes) + '}').error, /larger than 10 MB/);
  });
  test('utf8Bytes counts multi-byte characters', () => {
    assert.equal(C.utf8Bytes('a'), 1);
    assert.equal(C.utf8Bytes('é'), 2);
    assert.equal(C.utf8Bytes('€'), 3);
    assert.equal(C.utf8Bytes('😀'), 4);
  });
  test('esc escapes all five HTML-significant characters', () => {
    assert.equal(C.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(C.esc(null), '');
  });
});
