// Interface helpers. Node runs the TypeScript directly (type stripping, Node 22.18+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVIRONMENTS, swapEnvToken, copyProfile, cellKind, display, roleIndex, lineCol, shortType, blankProfile, effectiveEnv,
  hasWrite, nextEnvId, validEnvId, documentsToGrid, cellText, bsonType, idText, formatBytes,
} from '../src/logic.ts';

const [dev, staging, prod] = DEFAULT_ENVIRONMENTS;

test('swapEnvToken matches berth-core: whole words only, matched by position', () => {
  assert.deepEqual(swapEnvToken('db.dev.acme.internal', dev, staging), { value: 'db.staging.acme.internal', n: 1 });
  assert.equal(swapEnvToken('acme_dev_write', dev, staging).value, 'acme_staging_write');
  assert.equal(swapEnvToken('devices.acme.io', dev, prod).value, 'devices.acme.io');
  assert.equal(swapEnvToken('api-stg-1.acme.io', staging, prod).value, 'api-prd-1.acme.io');
  assert.equal(swapEnvToken('production-db', prod, dev).value, 'development-db');
});

test('swapEnvToken works with environments the workspace defines', () => {
  const qa = { id: 'qa', label: 'QA', color: '#336699', production: false, longName: 'quality' };
  const local = { id: 'local', label: 'local', color: '#999999', production: false };
  assert.equal(swapEnvToken('db.qa.acme.io', qa, local).value, 'db.local.acme.io');
  assert.equal(swapEnvToken('quality-db', qa, prod).value, 'production-db');
});

test('copyProfile drops secrets and makes production read-only', () => {
  const p = { endpoints: [{ role: 'write', host: 'db.dev.acme.io', port: 5432, database: 'acme_dev', user: 'app', tls: 'auto', secret: 'keychain://berth-studio/acme-db/dev/write-0' }], readOnly: false, autoRoute: true };
  const { profile, replaced } = copyProfile(p, dev, prod);
  assert.equal(replaced, 2);
  assert.equal(profile.endpoints[0].host, 'db.prod.acme.io');
  assert.equal(profile.endpoints[0].secret, null);
  assert.equal(profile.readOnly, true);
  assert.equal(p.endpoints[0].secret, 'keychain://berth-studio/acme-db/dev/write-0');
  const m = copyProfile(blankProfile(dev, 'mongodb'), dev, prod).profile;
  assert.equal(m.readOnly, true);
});

test('a tab follows the workspace environment unless it is pinned', () => {
  assert.equal(effectiveEnv(DEFAULT_ENVIRONMENTS, 'dev'), 'dev');
  assert.equal(effectiveEnv(DEFAULT_ENVIRONMENTS, 'dev', 'prod'), 'prod');
  assert.equal(effectiveEnv(DEFAULT_ENVIRONMENTS, 'dev', 'gone'), 'dev', 'a pin to a deleted environment falls back');
});

test('environment ids and new defaults', () => {
  assert.equal(nextEnvId(DEFAULT_ENVIRONMENTS), 'env-4');
  for (const ok of ['dev', 'prod-eu', 'qa_2']) assert.ok(validEnvId(ok), ok);
  for (const bad of ['', 'Dev', '1st', 'a/b', 'x'.repeat(25)]) assert.ok(!validEnvId(bad), bad);
  assert.equal(blankProfile(prod).readOnly, true);
  assert.equal(blankProfile(dev, 'mongodb').endpoints[0].uri, 'mongodb://127.0.0.1:27017/');
});

test('read-only profiles have no write endpoint', () => {
  assert.ok(hasWrite(blankProfile(dev)));
  assert.ok(!hasWrite({ endpoints: [{ role: 'read' }], readOnly: false, autoRoute: true }));
});

test('cells are coloured by their Postgres type', () => {
  assert.equal(cellKind(null, { name: 'x', primaryKey: false }), 'null');
  assert.equal(cellKind('12', { name: 'id', typeName: 'integer', primaryKey: true }), 'num');
  assert.equal(cellKind('{"a":1}', { name: 'm', typeName: 'jsonb', primaryKey: false }), 'json');
  assert.equal(cellKind('2026-10-01 00:00:00+07', { name: 't', typeName: 'timestamp with time zone', primaryKey: false }), 'date');
  assert.equal(cellKind('t', { name: 'b', typeName: 'boolean', primaryKey: false }), 'bool');
  assert.equal(cellKind('12.5', undefined), 'num');
  assert.equal(display('t', { name: 'b', typeName: 'boolean', primaryKey: false }), 'true');
  assert.equal(display(null, undefined), 'NULL');
  assert.equal(shortType('timestamp with time zone'), 'timestamptz');
});

test('MongoDB documents become grid columns with BSON types', () => {
  const docs = [
    { _id: { $oid: '6512bd43d9caa6e02c990b0a' }, type: 'click', at: { $date: '2026-10-14T01:00:00Z' }, amount: { $numberDecimal: '19.99' }, meta: { tags: ['a'] } },
    { _id: { $oid: '6512bd43d9caa6e02c990b0b' }, type: 'view', extra: true, at: null },
  ];
  const { columns, rows } = documentsToGrid(docs);
  assert.deepEqual(columns.map(c => c.name), ['_id', 'type', 'at', 'amount', 'meta', 'extra']);
  assert.deepEqual(columns.map(c => c.typeName), ['objectId', 'string', 'timestamp', 'decimal', 'object', 'boolean']);
  assert.equal(rows[0][0], '6512bd43d9caa6e02c990b0a');
  assert.equal(rows[0][3], '19.99');
  assert.equal(rows[0][4], '{"tags":["a"]}');
  assert.equal(rows[1][2], null, 'an explicit null');
  assert.equal(rows[1][3], '', 'a missing field');
  assert.equal(cellKind(rows[0][3], columns[3]), 'num');
  assert.equal(cellKind(rows[0][2], columns[2]), 'date');
  assert.equal(bsonType([1]), 'array');
  assert.equal(cellText({ $numberLong: '9007199254740993' }), '9007199254740993');
  assert.equal(idText(docs[0]), '{"$oid":"6512bd43d9caa6e02c990b0a"}');
});

test('passwords are matched by the index within a role', () => {
  const p = { endpoints: [{ role: 'write' }, { role: 'read' }, { role: 'read' }], readOnly: false, autoRoute: true };
  assert.deepEqual([0, 1, 2].map(i => roleIndex(p, i)), [0, 0, 1]);
});

test('lineCol turns a Postgres position into line and column', () => {
  assert.deepEqual(lineCol('SELECT 1,\n  nope FROM t', 13), { line: 2, col: 3 });
});

test('formatBytes shows kilobytes below a megabyte and one decimal above', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(860_000), '840 KB');
  assert.equal(formatBytes(13_002_342), '12.4 MB');
});
