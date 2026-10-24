// Pure helpers for the interface. No DOM and no IPC, so tests/ can run them with node --test.
import type {
  Column, Connection, EditPlan, Endpoint, Engine, EnvId, Environment, Filter, FilterOp, ForeignKey, Json, Profile, Role, RowCount, Sort, Table,
} from './types';

/** The environments a new workspace starts with; the Rust side owns the real list. */
export const DEFAULT_ENVIRONMENTS: Environment[] = [
  { id: 'dev', label: 'dev', color: '#1E8E50', production: false, longName: 'development' },
  { id: 'staging', label: 'staging', color: '#B26A00', production: false, shortName: 'stg' },
  { id: 'prod', label: 'prod', color: '#C8372F', production: true, longName: 'production', shortName: 'prd' },
];

export function findEnv(envs: Environment[], id: EnvId | undefined): Environment | undefined {
  return envs.find(e => e.id === id);
}

/** A tab follows the workspace environment unless it is pinned to its own. */
export function effectiveEnv(envs: Environment[], workspaceEnv: EnvId, pinned?: EnvId): EnvId {
  return pinned && findEnv(envs, pinned) ? pinned : workspaceEnv;
}

export function blankEndpoint(role: Role, from?: Endpoint): Endpoint {
  return {
    role,
    host: from?.host ?? 'localhost',
    port: from?.port ?? 5432,
    database: from?.database ?? '',
    user: role === 'read' && from?.user ? `${from.user}_ro` : from?.user ?? '',
    tls: from?.tls ?? 'auto',
    secret: null,
  };
}

export function blankMongoEndpoint(): Endpoint {
  return { role: 'write', host: '', port: 0, database: '', user: '', uri: 'mongodb://127.0.0.1:27017/', authSource: 'admin', tls: 'auto', secret: null };
}

export function blankProfile(env: Environment, engine: Engine = 'postgres'): Profile {
  return engine === 'mongodb'
    ? { endpoints: [blankMongoEndpoint()], readOnly: env.production, autoRoute: true, readPreference: 'primary' }
    : { endpoints: [blankEndpoint('write')], readOnly: env.production, autoRoute: true };
}

export function hasRead(p: Profile | undefined): boolean {
  return !!p?.endpoints.some(e => e.role === 'read');
}

export function hasWrite(p: Profile | undefined): boolean {
  return !!p?.endpoints.some(e => e.role === 'write');
}

/** Tables grouped by schema for the sidebar: `public` first, the rest in the order the catalog listed them. */
export function groupBySchema(tables: Table[]): { schema: string; tables: Table[] }[] {
  const groups: { schema: string; tables: Table[] }[] = [];
  for (const t of tables) {
    let g = groups.find(x => x.schema === t.schema);
    if (!g) groups.push((g = { schema: t.schema, tables: [] }));
    g.tables.push(t);
  }
  return groups.sort((a, b) => (a.schema === 'public' ? -1 : b.schema === 'public' ? 1 : 0));
}

/** The sidebar filter: a case-insensitive substring of any label. An empty filter matches everything. */
export function matchesFilter(needle: string, ...labels: string[]): boolean {
  const q = needle.trim().toLowerCase();
  return !q || labels.some(l => l.toLowerCase().includes(q));
}

/** What the status bar says about a table tab: whether rows can be changed, and why not. */
export function browseStatus(p: Profile | undefined, production: boolean, canEdit: boolean): string {
  if (!p || !hasWrite(p)) return 'read-only profile';
  if (production) return canEdit ? 'production · an edit asks for the connection name' : 'production is read-only';
  if (p.readOnly) return 'read-only profile';
  return canEdit ? 'editable · changes are reviewed before commit' : 'read-write profile';
}

/** The primary-key values of a row, as the key edits are grouped by. */
export function rowKey(row: (string | null)[], columns: Column[]): string {
  return JSON.stringify(columns.flatMap((c, i) => (c.primaryKey ? [row[i]] : [])));
}

export function editKey(key: string, column: string): string {
  return JSON.stringify([key, column]);
}

/** What a typed cell means: empty or `NULL` is SQL NULL. */
export function parseCellInput(text: string): string | null {
  return text === '' || text === 'NULL' ? null : text;
}

/** Groups pending edits by row; the key holds the values the row had when it was read. */
export function editsToPlan(edits: Record<string, string | null>, rows: (string | null)[][], columns: Column[]): EditPlan {
  const byKey = new Map<string, (string | null)[]>();
  for (const r of rows) byKey.set(rowKey(r, columns), r);
  const plan = new Map<string, EditPlan['rows'][number]>();
  for (const [k, value] of Object.entries(edits)) {
    const [key, column] = JSON.parse(k) as [string, string];
    const row = byKey.get(key);
    if (!row) continue;
    let entry = plan.get(key);
    if (!entry) {
      entry = { key: columns.flatMap((c, i) => (c.primaryKey ? [{ column: c.name, value: row[i] }] : [])), set: [] };
      plan.set(key, entry);
    }
    entry.set.push({ column, value });
  }
  return { rows: [...plan.values()] };
}

/** Whether a grid can be edited, and the reason when it cannot. */
export function canEditTable(columns: Column[], kind?: string): { ok: boolean; reason?: string } {
  if (kind && kind !== 'table' && kind !== 'partitioned table') return { ok: false, reason: `A ${kind} cannot be edited inline` };
  if (!columns.some(c => c.primaryKey)) return { ok: false, reason: 'No primary key, so rows cannot be edited inline' };
  return { ok: true };
}

/** The filter operators, in menu order. */
export const OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: 'eq', label: '=', needsValue: true },
  { op: 'ne', label: '≠', needsValue: true },
  { op: 'lt', label: '<', needsValue: true },
  { op: 'le', label: '≤', needsValue: true },
  { op: 'gt', label: '>', needsValue: true },
  { op: 'ge', label: '≥', needsValue: true },
  { op: 'contains', label: 'contains', needsValue: true },
  { op: 'startsWith', label: 'starts with', needsValue: true },
  { op: 'isNull', label: 'is null', needsValue: false },
  { op: 'isNotNull', label: 'is not null', needsValue: false },
  { op: 'in', label: 'in', needsValue: true },
];

/** A chip's text: `plan ≠ 'deleted'`, `last_login is null`, `id in (1, 2, 3)`. */
export function filterText(f: Filter): string {
  const label = OPS.find(o => o.op === f.op)?.label ?? f.op;
  if (f.op === 'isNull' || f.op === 'isNotNull') return `${f.column} ${label}`;
  if (f.op === 'in') return `${f.column} in (${(f.values ?? []).join(', ')})`;
  return `${f.column} ${label} '${f.value ?? ''}'`;
}

/** The values of an `in` filter as typed: split on commas or newlines, trimmed, without repeats. */
export function parseInValues(text: string): string[] {
  const out: string[] = [];
  for (const v of text.split(/[,\n]/).map(x => x.trim())) if (v && !out.includes(v)) out.push(v);
  return out;
}

/** Indexes of the rows whose any cell contains `needle`, case-insensitively; every row when it is blank. */
export function findRows(rows: (string | null)[][], needle: string): number[] {
  const q = needle.trim().toLowerCase();
  if (!q) return rows.map((_, i) => i);
  return rows.flatMap((r, i) => (r.some(v => v !== null && v.toLowerCase().includes(q)) ? [i] : []));
}

/** 1.3k, 8.0k, 2.4M: row counts for the sidebar and footer. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "Rows 1–200 of 1,300" with an exact count, "Rows 1–200 of ~1.3k" with an estimate, "Rows 1–200" without one. */
export function rowCountText(offset: number, shown: number, count: RowCount | null): string {
  if (!shown) return '';
  const range = `Rows ${(offset + 1).toLocaleString('en-US')}–${(offset + shown).toLocaleString('en-US')}`;
  if (!count || count.total === null) return range;
  return count.exact ? `${range} of ${count.total.toLocaleString('en-US')}` : `${range} of ~${compact(count.total)}`;
}

/** Marks each column that is part of a foreign key with the column it points at. */
export function attachForeignKeys(columns: Column[], fks: ForeignKey[]): Column[] {
  return columns.map(c => {
    for (const fk of fks) {
      const i = fk.columns.indexOf(c.name);
      if (i >= 0) return { ...c, fk: { schema: fk.refSchema, table: fk.refTable, column: fk.refColumns[i] } };
    }
    return c;
  });
}

/** `→ orgs.id`; the schema shows only when it is not `public`. */
export function fkLabel(fk: { schema: string; table: string; column: string }): string {
  return `→ ${tableLabel(fk.schema, fk.table)}.${fk.column}`;
}

export function tableLabel(schema: string, table: string): string {
  return schema === 'public' ? table : `${schema}.${table}`;
}

/**
 * The chips that open the other side of a foreign key for one row: the row it points at
 * (`out`), or the rows that point at it (`in`). Null when a key value is NULL, which no row matches.
 */
export function fkFilters(fk: ForeignKey, row: (string | null)[], columns: Column[], direction: 'out' | 'in'): Filter[] | null {
  const from = direction === 'out' ? fk.columns : fk.refColumns;
  const to = direction === 'out' ? fk.refColumns : fk.columns;
  const out: Filter[] = [];
  for (let i = 0; i < from.length; i++) {
    const v = row[columns.findIndex(c => c.name === from[i])];
    if (v === null || v === undefined) return null;
    out.push({ column: to[i], op: 'eq', value: v });
  }
  return out;
}

/** Clicking a header cycles none → ascending → descending → none for that column. */
export function nextSort(current: Sort | null, column: string): Sort | null {
  if (!current || current.column !== column) return { column, descending: false };
  return current.descending ? null : { column, descending: true };
}

/** Index of an endpoint among the endpoints that share its role (how passwords are matched). */
export function roleIndex(p: Profile, i: number): number {
  const role = p.endpoints[i].role;
  return p.endpoints.slice(0, i).filter(e => e.role === role).length;
}

/** id, long form, short form; a missing form falls back to the id. Same rule as berth-core. */
export function envWords(e: Environment): [string, string, string] {
  return [e.id, e.longName || e.id, e.shortName || e.id];
}

/** Same rule as berth-core's swap_env_token: whole words only, matched by position. */
export function swapEnvToken(s: string, from: Environment, to: Environment): { value: string; n: number } {
  if (from.id === to.id) return { value: s, n: 0 };
  const f = envWords(from), t = envWords(to);
  let value = s;
  let n = 0;
  const done = new Set<string>();
  f.forEach((word, k) => {
    if (done.has(word)) return;
    done.add(word);
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'g'), (_m, pre: string) => {
      n++;
      return pre + t[k];
    });
  });
  return { value, n };
}

/** A copy for another environment: names swapped, secrets dropped, production read-only. */
export function copyProfile(p: Profile, from: Environment, to: Environment): { profile: Profile; replaced: number } {
  let replaced = 0;
  const swap = (s: string) => {
    const r = swapEnvToken(s, from, to);
    replaced += r.n;
    return r.value;
  };
  const endpoints = p.endpoints.map(e => ({
    ...e,
    host: swap(e.host),
    database: swap(e.database),
    user: swap(e.user),
    ...(e.uri !== undefined ? { uri: swap(e.uri) } : {}),
    secret: null,
    needsSecret: true,
  }));
  return { profile: { ...p, endpoints, readOnly: to.production ? true : p.readOnly, copiedFrom: from.id }, replaced };
}

/** Environments a connection has a profile in, in workspace order. */
export function profileEnvs(c: Connection, envs: Environment[]): Environment[] {
  return envs.filter(e => !!c.profiles[e.id]);
}

/** A new, unused environment id such as "env-2". */
export function nextEnvId(envs: Environment[]): EnvId {
  let i = envs.length + 1;
  while (envs.some(e => e.id === `env-${i}`)) i++;
  return `env-${i}`;
}

export function validEnvId(id: string): boolean {
  return /^[a-z][a-z0-9_-]{0,23}$/.test(id);
}

export type CellKind = 'num' | 'str' | 'null' | 'json' | 'date' | 'bool' | 'plain';

export function cellKind(value: string | null, col: Column | undefined): CellKind {
  if (value === null) return 'null';
  const t = (col?.typeName ?? '').toLowerCase();
  if (!t) return /^-?\d+(\.\d+)?$/.test(value) ? 'num' : 'plain';
  if (/^(smallint|integer|bigint|numeric|real|double precision|money|int|long|double|decimal)|^numeric\(/.test(t)) return 'num';
  if (t.startsWith('json') || t === 'object' || t === 'array') return 'json';
  if (t.startsWith('timestamp') || t === 'date' || t.startsWith('time') || t === 'interval') return 'date';
  if (t === 'boolean' || t === 'bool') return 'bool';
  return 'str';
}

/** Postgres sends booleans as t / f through the simple protocol and as true / false when cast to text. */
export function display(value: string | null, col: Column | undefined): string {
  if (value === null) return 'NULL';
  if (col?.typeName === 'boolean') return value === 't' ? 'true' : value === 'f' ? 'false' : value;
  return value;
}

/** Shorter type names for column headers. */
export function shortType(t?: string): string {
  if (!t) return '';
  return t
    .replace('timestamp with time zone', 'timestamptz')
    .replace('timestamp without time zone', 'timestamp')
    .replace('character varying', 'varchar')
    .replace('double precision', 'float8');
}

/** The BSON type name of a relaxed Extended JSON value. */
export function bsonType(v: Json | undefined): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    if ('$oid' in v) return 'objectId';
    if ('$date' in v) return 'date';
    if ('$numberDecimal' in v) return 'decimal';
    if ('$numberLong' in v) return 'long';
    if ('$binary' in v) return 'binData';
    return 'object';
  }
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'boolean') return 'bool';
  return 'string';
}

/** Shows an Extended JSON value in one grid cell. */
export function cellText(v: Json | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (!Array.isArray(v)) {
    if (typeof v.$oid === 'string') return v.$oid;
    if (typeof v.$date === 'string') return v.$date;
    if (v.$date && typeof v.$date === 'object' && '$numberLong' in v.$date) return String(v.$date.$numberLong);
    if (typeof v.$numberDecimal === 'string') return v.$numberDecimal;
    if (typeof v.$numberLong === 'string') return v.$numberLong;
  }
  return JSON.stringify(v);
}

const TYPE_FOR_GRID: Record<string, string> = {
  objectId: 'objectId', date: 'timestamp', decimal: 'decimal', long: 'long', int: 'int', double: 'double',
  bool: 'boolean', object: 'object', array: 'array', string: 'string', binData: 'binData',
};

/**
 * Turns documents into grid columns and rows: one column per top-level field, in first-seen
 * order, with `_id` first. The column type is the first non-null value's BSON type.
 */
export function documentsToGrid(docs: { [k: string]: Json }[], maxColumns = 40): { columns: Column[]; rows: (string | null)[][] } {
  const names: string[] = [];
  for (const d of docs.slice(0, 200)) {
    for (const k of Object.keys(d)) if (!names.includes(k)) names.push(k);
  }
  names.sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0));
  const keys = names.slice(0, maxColumns);
  const columns = keys.map(name => {
    const first = docs.find(d => d[name] !== undefined && d[name] !== null)?.[name];
    const raw = bsonType(first);
    const typeName = raw === 'bool' ? 'boolean' : TYPE_FOR_GRID[raw] ?? raw;
    return { name, typeName, primaryKey: name === '_id' };
  });
  const rows = docs.map(d => keys.map(k => (k in d && d[k] !== null ? cellText(d[k]) : d[k] === null ? null : '')));
  return { columns, rows };
}

/** The `_id` of a document as the Extended JSON text the Rust side expects. */
export function idText(doc: { [k: string]: Json }): string {
  return JSON.stringify(doc._id);
}

export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Line and column (1-based) of a character position reported by Postgres. */
export function lineCol(sql: string, position: number): { line: number; col: number } {
  const before = sql.slice(0, Math.max(0, position - 1)).split('\n');
  return { line: before.length, col: before[before.length - 1].length + 1 };
}

/** Download sizes for the update progress: "840 KB", "12.4 MB". */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
