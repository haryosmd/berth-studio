// Interface helpers. Node runs the TypeScript directly (type stripping, Node 22.18+).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ENVIRONMENTS, swapEnvToken, copyProfile, cellKind, display, roleIndex, lineCol, shortType, blankProfile, effectiveEnv,
  hasWrite, nextEnvId, validEnvId, documentsToGrid, cellText, bsonType, idText, formatBytes, groupBySchema, matchesFilter, browseStatus,
  filterText, parseInValues, findRows, rowCountText, nextSort, compact, attachForeignKeys, fkFilters, fkLabel, tableLabel,
  rowKey, editKey, parseCellInput, editsToPlan, canEditTable,
  sqlSummary, historyDay, clockTime, toCsv, toJson, uniqueNames, exportName, toSqlNamespace, fuzzyScore,
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
  assert.equal(display('false', { name: 'b', typeName: 'boolean', primaryKey: false }), 'false', 'a boolean cast to text');
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

test('the sidebar groups tables by schema, public first', () => {
  const t = (schema, name) => ({ schema, name, kind: 'table', estimatedRows: 1 });
  const groups = groupBySchema([t('audit', 'log'), t('public', 'users'), t('public', 'orders'), t('billing', 'invoices')]);
  assert.deepEqual(groups.map(g => g.schema), ['public', 'audit', 'billing']);
  assert.deepEqual(groups[0].tables.map(x => x.name), ['users', 'orders'], 'catalog order is kept inside a schema');
  assert.deepEqual(groupBySchema([]), []);
});

test('the sidebar filter is a case-insensitive substring of any label', () => {
  assert.ok(matchesFilter('', 'anything'));
  assert.ok(matchesFilter('  ', 'anything'), 'blank is empty');
  assert.ok(matchesFilter('ORD', 'orders'));
  assert.ok(matchesFilter('acme', 'users', 'acme-db'));
  assert.ok(!matchesFilter('zzz', 'users', 'orders'));
});

test('the status bar explains whether a table can be edited', () => {
  const write = blankProfile(dev);
  assert.equal(browseStatus(write, true, true), 'production · an edit asks for the connection name');
  assert.equal(browseStatus(write, true, false), 'production is read-only');
  assert.equal(browseStatus(undefined, false, true), 'read-only profile');
  assert.equal(browseStatus({ ...write, readOnly: true }, false, true), 'read-only profile');
  assert.equal(browseStatus({ endpoints: [{ role: 'read' }], readOnly: false, autoRoute: true }, false, true), 'read-only profile');
  assert.equal(browseStatus(write, false, true), 'editable · changes are reviewed before commit');
  assert.equal(browseStatus(write, false, false), 'read-write profile');
});

test('filter chips read like SQL', () => {
  assert.equal(filterText({ column: 'plan', op: 'ne', value: 'deleted' }), "plan ≠ 'deleted'");
  assert.equal(filterText({ column: 'last_login', op: 'isNull' }), 'last_login is null');
  assert.equal(filterText({ column: 'id', op: 'in', values: ['1', '2', '3'] }), 'id in (1, 2, 3)');
  assert.equal(filterText({ column: 'email', op: 'contains', value: 'acme' }), "email contains 'acme'");
  assert.deepEqual(parseInValues(' 1, 2,,3\n2 '), ['1', '2', '3']);
});

test('find in results matches any cell, case-insensitively', () => {
  const rows = [['1', 'user1@acme.dev', null], ['2', 'USER12@acme.dev', 'x'], ['3', 'other', null]];
  assert.deepEqual(findRows(rows, 'user1'), [0, 1]);
  assert.deepEqual(findRows(rows, 'X'), [1]);
  assert.deepEqual(findRows(rows, ''), [0, 1, 2]);
  assert.deepEqual(findRows(rows, 'null'), [], 'NULL cells are not text');
});

test('the footer shows the range and an exact or estimated total', () => {
  assert.equal(rowCountText(0, 200, { total: 1300, exact: true }), 'Rows 1–200 of 1,300');
  assert.equal(rowCountText(200, 200, { total: 1300, exact: false }), 'Rows 201–400 of ~1.3k');
  assert.equal(rowCountText(0, 50, { total: null, exact: false }), 'Rows 1–50');
  assert.equal(rowCountText(0, 50, null), 'Rows 1–50');
  assert.equal(rowCountText(0, 0, { total: 0, exact: true }), '');
  assert.equal(compact(999), '999');
  assert.equal(compact(8000), '8.0k');
  assert.equal(compact(2_400_000), '2.4M');
});

test('foreign keys annotate columns and turn a row into chips for the other side', () => {
  const columns = [{ name: 'id', primaryKey: true }, { name: 'org_id', primaryKey: false }, { name: 'region', primaryKey: false }];
  const fk = { name: 'users_org_fkey', schema: 'public', table: 'users', columns: ['org_id', 'region'], refSchema: 'billing', refTable: 'orgs', refColumns: ['id', 'region'] };
  const annotated = attachForeignKeys(columns, [fk]);
  assert.equal(annotated[0].fk, undefined);
  assert.deepEqual(annotated[1].fk, { schema: 'billing', table: 'orgs', column: 'id' });
  assert.deepEqual(annotated[2].fk, { schema: 'billing', table: 'orgs', column: 'region' });
  assert.equal(fkLabel(annotated[1].fk), '→ billing.orgs.id');
  assert.equal(fkLabel({ schema: 'public', table: 'orgs', column: 'id' }), '→ orgs.id');
  assert.equal(tableLabel('public', 'users'), 'users');
  assert.deepEqual(fkFilters(fk, ['7', '5', 'eu'], columns, 'out'), [{ column: 'id', op: 'eq', value: '5' }, { column: 'region', op: 'eq', value: 'eu' }]);
  assert.equal(fkFilters(fk, ['7', null, 'eu'], columns, 'out'), null, 'a NULL key points nowhere');
  const orgColumns = [{ name: 'id', primaryKey: true }, { name: 'region', primaryKey: false }];
  assert.deepEqual(fkFilters(fk, ['5', 'eu'], orgColumns, 'in'), [{ column: 'org_id', op: 'eq', value: '5' }, { column: 'region', op: 'eq', value: 'eu' }]);
});

test('grid edits are grouped by primary key with the original key values', () => {
  const columns = [{ name: 'org', primaryKey: true }, { name: 'id', primaryKey: true }, { name: 'plan', primaryKey: false }, { name: 'note', primaryKey: false }];
  const rows = [['1', '10', 'pro', null], ['1', '11', 'team', 'x']];
  assert.equal(rowKey(rows[0], columns), '["1","10"]');
  const edits = {
    [editKey(rowKey(rows[0], columns), 'plan')]: 'team',
    [editKey(rowKey(rows[0], columns), 'note')]: 'hello',
    [editKey(rowKey(rows[1], columns), 'note')]: null,
    [editKey('["gone"]', 'plan')]: 'x',
  };
  assert.deepEqual(editsToPlan(edits, rows, columns), {
    rows: [
      { key: [{ column: 'org', value: '1' }, { column: 'id', value: '10' }], set: [{ column: 'plan', value: 'team' }, { column: 'note', value: 'hello' }] },
      { key: [{ column: 'org', value: '1' }, { column: 'id', value: '11' }], set: [{ column: 'note', value: null }] },
    ],
  });
  assert.equal(parseCellInput(''), null);
  assert.equal(parseCellInput('NULL'), null);
  assert.equal(parseCellInput('null'), 'null', 'only the SQL spelling means NULL');
  assert.equal(parseCellInput(' 0 '), ' 0 ');
  assert.deepEqual(canEditTable(columns, 'table'), { ok: true });
  assert.equal(canEditTable(columns, 'view').ok, false);
  assert.equal(canEditTable([{ name: 'a', primaryKey: false }], 'table').reason, 'No primary key, so rows cannot be edited inline');
});

test('a header click cycles the sort', () => {
  assert.deepEqual(nextSort(null, 'id'), { column: 'id', descending: false });
  assert.deepEqual(nextSort({ column: 'id', descending: false }, 'id'), { column: 'id', descending: true });
  assert.equal(nextSort({ column: 'id', descending: true }, 'id'), null);
  assert.deepEqual(nextSort({ column: 'id', descending: true }, 'plan'), { column: 'plan', descending: false });
});

test('formatBytes shows kilobytes below a megabyte and one decimal above', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(860_000), '840 KB');
  assert.equal(formatBytes(13_002_342), '12.4 MB');
});

test('sqlSummary skips comments and blank lines', () => {
  assert.equal(sqlSummary('-- top users\n\nSELECT id,\n  email FROM users'), 'SELECT id,');
  assert.equal(sqlSummary('  select   1  '), 'select 1');
  assert.equal(sqlSummary('-- only a comment'), '-- only a comment');
  assert.equal(sqlSummary(''), '');
});

test('history groups by local day and shows a 24-hour time', () => {
  const now = new Date(2026, 9, 24, 10, 0).getTime();
  assert.equal(historyDay(new Date(2026, 9, 24, 0, 5).getTime(), now), 'Today');
  assert.equal(historyDay(new Date(2026, 9, 23, 23, 59).getTime(), now), 'Yesterday');
  assert.equal(historyDay(new Date(2026, 9, 20, 12).getTime(), now), 'Tue, Oct 20');
  assert.equal(clockTime(new Date(2026, 9, 24, 9, 2).getTime()), '09:02');
});

test('toCsv quotes per RFC 4180 and defuses formulas but not numbers', () => {
  assert.equal(toCsv(['id', 'note'], [['1', 'a,b'], ['2', 'say "hi"'], ['3', null], ['4', 'two\nlines']]),
    'id,note\r\n1,"a,b"\r\n2,"say ""hi"""\r\n3,\r\n4,"two\nlines"\r\n');
  assert.equal(toCsv(['v'], [['=HYPERLINK("x")'], ['-5'], ['-1.5e3'], ['+cmd'], ['@sum'], ['-']]),
    'v\r\n"\'=HYPERLINK(""x"")"\r\n-5\r\n-1.5e3\r\n\'+cmd\r\n\'@sum\r\n\'-\r\n');
});

test('toJson keeps text values, null for NULL, and unique keys', () => {
  assert.deepEqual(uniqueNames(['id', 'id', 'id_2', 'name']), ['id', 'id_2', 'id_2_2', 'name']);
  assert.deepEqual(JSON.parse(toJson(['id', 'id', 'n'], [['1', '2', null]])), [{ id: '1', id_2: '2', n: null }]);
});

test('exportName makes a safe file name', () => {
  assert.equal(exportName('users', 'csv'), 'users.csv');
  assert.equal(exportName('revenue-by-plan.sql', 'json'), 'revenue-by-plan.json');
  assert.equal(exportName('Query 1 / draft', 'csv'), 'Query-1-draft.csv');
  assert.equal(exportName('../..', 'csv'), 'export.csv');
});

test('toSqlNamespace nests schema, table and columns with their types', () => {
  const ns = toSqlNamespace([
    { schema: 'public', table: 'users', column: 'id', typeName: 'integer' },
    { schema: 'public', table: 'users', column: 'email', typeName: 'text' },
    { schema: 'billing', table: 'invoices', column: 'total', typeName: 'numeric(10,2)' },
  ]);
  assert.deepEqual(ns.public.users.map(c => c.label), ['id', 'email']);
  assert.deepEqual(ns.billing.invoices[0], { label: 'total', type: 'property', detail: 'numeric(10,2)' });
});

test('fuzzyScore matches in order and ranks prefixes and word starts first', () => {
  assert.equal(fuzzyScore('usr', 'orders'), null);
  assert.ok(fuzzyScore('usr', 'users') !== null);
  assert.ok(fuzzyScore('users', 'users · acme-db') > fuzzyScore('users', 'old_users_archive'));
  assert.ok(fuzzyScore('nc', 'New connection') > fuzzyScore('nc', 'sync'));
  assert.equal(fuzzyScore('  ', 'anything'), 0);
});
