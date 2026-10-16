// Sample backend for previewing the interface in a browser during development. Never bundled in a
// production build (see api.ts) and never talks to a database. It mirrors the Rust rules that
// matter for the screens: production writes need the typed name, read-only profiles cannot write.
import type {
  BrowseRequest, CollectionInfo, Connection, Documents, Environment, Filter, Json, Page, ResultSet, RunResult, Table,
} from './types';
import { DEFAULT_ENVIRONMENTS } from './logic';

let envs: Environment[] = structuredClone(DEFAULT_ENVIRONMENTS);

const conns: Connection[] = [
  {
    id: 'acme-db',
    engine: 'postgres',
    profiles: {
      dev: {
        readOnly: false,
        autoRoute: true,
        endpoints: [
          { role: 'write', host: 'db-w.dev.acme.internal', port: 5432, database: 'acme', user: 'app', tls: 'auto', secret: 'keychain://berth-studio/acme-db/dev/write-0' },
          { role: 'read', host: 'db-r.dev.acme.internal', port: 5432, database: 'acme', user: 'app_ro', tls: 'auto', secret: 'keychain://berth-studio/acme-db/dev/read-0' },
        ],
      },
      staging: {
        readOnly: false,
        autoRoute: true,
        endpoints: [
          { role: 'write', host: 'db-w.staging.acme.io', port: 5432, database: 'acme', user: 'app', tls: 'auto', secret: 'keychain://berth-studio/acme-db/staging/write-0' },
          { role: 'read', host: 'db-r.staging.acme.io', port: 5432, database: 'acme', user: 'app_ro', tls: 'auto', secret: 'keychain://berth-studio/acme-db/staging/read-0' },
        ],
      },
      prod: {
        readOnly: true,
        autoRoute: true,
        endpoints: [{ role: 'read', host: 'db-ro.prod.acme.io', port: 5432, database: 'acme', user: 'readonly', tls: 'auto', secret: 'keychain://berth-studio/acme-db/prod/read-0' }],
      },
    },
  },
  {
    id: 'events-db',
    engine: 'mongodb',
    profiles: {
      staging: { readOnly: false, autoRoute: true, readPreference: 'secondaryPreferred', endpoints: [{ role: 'write', host: '', port: 0, database: '', user: 'app', uri: 'mongodb+srv://cluster0-stg.acme.net/', authSource: 'admin', tls: 'auto', secret: 'keychain://berth-studio/events-db/staging/write-0' }] },
      prod: { readOnly: true, autoRoute: true, readPreference: 'secondaryPreferred', endpoints: [{ role: 'write', host: '', port: 0, database: '', user: 'app', uri: 'mongodb+srv://cluster0.acme.net/', authSource: 'admin', tls: 'auto', secret: 'keychain://berth-studio/events-db/prod/write-0' }] },
    },
  },
];

const tables: Table[] = ['orders', 'orgs', 'users'].map((name, i) => ({ schema: 'public', name, kind: 'table', estimatedRows: [8000, 20, 1300][i] }));

const USER_COLUMNS = (() => {
  const t = ['integer', 'text', 'text', 'integer', 'text', 'boolean', 'jsonb', 'timestamp with time zone'];
  const names = ['id', 'email', 'full_name', 'org_id', 'plan', 'is_verified', 'metadata', 'last_login'];
  return names.map((name, i) => ({ name, typeName: t[i], primaryKey: i === 0 }));
})();
const ALL_USERS: (string | null)[][] = Array.from({ length: 1300 }, (_, k) => {
  const g = k + 1;
  return [String(g), `user${g}@acme.dev`, `User ${g}`, String(1 + (g % 20)), ['starter', 'pro', 'team'][g % 3], g % 4 ? 'true' : 'false',
    g % 5 ? `{"source": "${['signup', 'invite', 'import'][g % 3]}"}` : null, g % 7 ? `2026-10-14 ${String(g % 24).padStart(2, '0')}:00:00+07` : null];
});

function matches(row: (string | null)[], f: Filter): boolean {
  const i = USER_COLUMNS.findIndex(c => c.name === f.column);
  if (i < 0) throw { message: `Unknown column ${f.column}.` };
  const v = row[i];
  const num = USER_COLUMNS[i].typeName === 'integer';
  const cmp = (a: string, b: string) => (num ? Number(a) - Number(b) : a.localeCompare(b));
  switch (f.op) {
    case 'isNull': return v === null;
    case 'isNotNull': return v !== null;
    case 'in': return v !== null && (f.values ?? []).includes(v);
    case 'contains': return v !== null && v.toLowerCase().includes((f.value ?? '').toLowerCase());
    case 'startsWith': return v !== null && v.toLowerCase().startsWith((f.value ?? '').toLowerCase());
    default: {
      if (v === null) return false;
      if (num && Number.isNaN(Number(f.value))) throw { message: `invalid input syntax for type integer: "${f.value}"`, code: '22P02' };
      const c = cmp(v, f.value ?? '');
      return f.op === 'eq' ? c === 0 : f.op === 'ne' ? c !== 0 : f.op === 'lt' ? c < 0 : f.op === 'le' ? c <= 0 : f.op === 'gt' ? c > 0 : c >= 0;
    }
  }
}

/** The mock understands chips and sort; a raw condition is accepted but only `;` is checked. */
function selectUsers(req: Partial<BrowseRequest>): (string | null)[][] {
  if (req.where && req.where.includes(';')) throw { message: 'The condition is one expression for WHERE; it cannot hold `;`.' };
  let rows = ALL_USERS.filter(r => (req.filters ?? []).every(f => matches(r, f)));
  if (req.sort) {
    const i = USER_COLUMNS.findIndex(c => c.name === req.sort!.column);
    const num = USER_COLUMNS[i]?.typeName === 'integer';
    rows = [...rows].sort((a, b) => {
      const x = a[i], y = b[i];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const c = num ? Number(x) - Number(y) : x.localeCompare(y);
      return req.sort!.descending ? -c : c;
    });
  }
  return rows;
}

function users(offset: number, limit: number, req: Partial<BrowseRequest> = {}): ResultSet {
  const rows = selectUsers(req).slice(offset, offset + limit);
  return { columns: USER_COLUMNS, rows, truncated: false, affected: rows.length };
}

const types = ['click', 'view', 'purchase'];
const events: { [k: string]: Json }[] = Array.from({ length: 120 }, (_, i) => ({
  _id: { $oid: `6512bd43d9caa6e02c99${i.toString(16).padStart(4, '0')}` },
  type: types[i % 3],
  user: `u${i % 50}`,
  at: { $date: new Date(Date.UTC(2026, 9, 14, 12) - i * 60000).toISOString() },
  ...(i % 3 === 2 ? { amount: { $numberDecimal: '19.99' } } : {}),
  meta: { source: ['web', 'ios', 'android'][i % 3], tags: i % 5 === 0 ? ['promo', 'q4'] : [] },
}));
const collections: CollectionInfo[] = [
  { name: 'events', kind: 'collection', count: events.length },
  { name: 'purchases', kind: 'view' },
  { name: 'sessions', kind: 'collection', count: 40 },
];

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const docs = (list: { [k: string]: Json }[], truncated = false): Documents => ({ documents: list, truncated, elapsedMs: 9 });
const prod = (env: string) => !!envs.find(e => e.id === env)?.production;
const confirmError = (id: string) => ({ message: `Writing to production needs confirmation. Type ${id} to continue.`, code: 'BERTH_CONFIRM_PROD' });

// Open the preview with ?slow to see the loading states.
const DELAY = new URLSearchParams(location.search).has('slow') ? 1500 : 120;

export async function invoke<T>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  await wait(DELAY);
  switch (cmd) {
    case 'list_environments': return structuredClone(envs) as T;
    case 'save_environments': {
      const next = args.environments as Environment[];
      const removed = envs.filter(e => !next.some(n => n.id === e.id)).map(e => e.id);
      const affected = conns.flatMap(c => removed.filter(r => c.profiles[r]).map(r => `${c.id} · ${r}`));
      if (affected.length && !args.confirmDelete) throw { message: `${affected.length} profile(s) belong to environments you are removing.`, detail: affected.join('\n'), code: 'BERTH_CONFIRM_ENV_DELETE' };
      for (const c of conns) for (const r of removed) delete c.profiles[r];
      envs = structuredClone(next);
      return structuredClone(envs) as T;
    }
    case 'list_connections': return structuredClone(conns) as T;
    case 'save_connection': {
      const c = args.connection as Connection;
      const i = conns.findIndex(x => x.id === c.id);
      if (i >= 0) conns[i] = c; else conns.push(c);
      return c as T;
    }
    case 'delete_connection': conns.splice(conns.findIndex(x => x.id === args.id), 1); return undefined as T;
    case 'test_profile': return (args.profile.endpoints as any[]).map((e, index) => ({ role: e.role, index, host: e.uri ?? e.host, ok: true, message: args.engine === 'mongodb' ? 'MongoDB 8.0.34 · replica set rs0' : 'PostgreSQL 16.15' })) as T;
    case 'list_tables': return tables as T;
    case 'browse_table': { const r = args.request as BrowseRequest; return { ...users(r.offset, r.limit, r), host: 'db-r.dev.acme.internal', elapsedMs: 7 } as Page as T; }
    case 'count_rows': {
      const r = args.request as BrowseRequest;
      return (r.filters.length || r.where ? { total: selectUsers(r).length, exact: true } : { total: 1300, exact: false }) as T;
    }
    case 'run_query': {
      const write = /^\s*(update|insert|delete|create|drop|alter)/i.test(args.sql);
      const p = conns.find(c => c.id === args.id)?.profiles[args.env];
      if (write && p && !p.endpoints.some(e => e.role === 'write')) throw { message: `The ${args.env} profile of ${args.id} has no write endpoint, so it can only read.`, code: 'BERTH_NO_WRITE' };
      if (write && prod(args.env) && args.confirm !== args.id) throw confirmError(args.id);
      const res: RunResult = {
        results: write ? [{ columns: [], rows: [], truncated: false, affected: 1 }]
          : /\bwhere\s+false\b/i.test(args.sql) ? [{ ...users(0, 0), affected: 0 }] : [users(0, 18)],
        role: write ? 'write' : 'read',
        reason: write ? 'The statement contains UPDATE.' : 'Read-only statement, routed to the read endpoint.',
        host: write ? 'db-w.dev.acme.internal' : 'db-r.dev.acme.internal', readOnly: !write, elapsedMs: 12,
      };
      return res as T;
    }
    case 'cancel_query': return false as T;
    case 'mongo_overview': return { server: { version: '8.0.34', topology: 'replica set rs0' }, databases: ['admin', 'events'] } as T;
    case 'list_collections': return (args.db === 'events' ? collections : []) as T;
    case 'find_documents': {
      let list = events;
      const filter = (args.request.filter as string).trim();
      if (filter) {
        const f = JSON.parse(filter) as Record<string, Json>;
        list = list.filter(d => Object.entries(f).every(([k, v]) => JSON.stringify(d[k]) === JSON.stringify(v)));
      }
      const { skip, limit } = args.request;
      return docs(list.slice(skip, skip + limit), list.length > skip + limit) as T;
    }
    case 'aggregate': {
      const writes = /"\$(out|merge)"/.test(args.pipeline);
      if (writes && prod(args.env) && args.confirm !== args.id) throw confirmError(args.id);
      return docs(types.map(t => ({ _id: t, n: events.filter(e => e.type === t).length }))) as T;
    }
    case 'list_indexes': return [{ name: '_id_', keys: { _id: 1 }, unique: false }, { name: 'type_1_at_-1', keys: { type: 1, at: -1 }, unique: false }] as T;
    case 'write_document': {
      if (prod(args.env) && args.confirm !== args.id) throw confirmError(args.id);
      return { message: args.change.action === 'delete' ? 'Deleted the document.' : args.change.action === 'insert' ? 'Inserted a document.' : 'Saved the document.' } as T;
    }
    case 'check_update': return { currentVersion: '0.1.0', version: '0.2.0', date: '2026-10-20T09:00:00Z',
      notes: "What's new\n- Filter bar in the table browser\n- Export results to CSV and JSON\n- Faster MongoDB collection counts" } as T;
    case 'install_update': {
      const send = args.onProgress as (p: object) => void;
      const total = 24_800_000;
      send({ event: 'started', total });
      for (let done = 0; done < total;) { await wait(90); done = Math.min(total, done + 1_900_000); send({ event: 'chunk', downloaded: done }); }
      send({ event: 'installed' });
      return undefined as T;
    }
    case 'restart_app': location.reload(); return undefined as T;
    default: throw { message: `unknown command ${cmd}` };
  }
}
