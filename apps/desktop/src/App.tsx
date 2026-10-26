import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { CollectionView } from './CollectionView';
import { CommandPalette, type PaletteItem } from './CommandPalette';
import { AskDialog, PromptDialog } from './ConfirmDialog';
import { ConnectionSheet } from './ConnectionSheet';
import { EnvironmentsSheet } from './EnvironmentsSheet';
import { HistoryDialog } from './HistoryDialog';
import { Icon, Mark } from './Icons';
import { QueryView, START } from './QueryView';
import { TableView } from './TableView';
import { Spinner, TreeNote } from './Status';
import { UpdateButton } from './UpdateButton';
import {
  DEFAULT_ENVIRONMENTS, browseStatus, clockTime, compact, effectiveEnv, filterText, findEnv, groupBySchema, hasRead, hasWrite, matchesFilter, sqlSummary,
} from './logic';
import type { CollectionInfo, Connection, DbError, EnvId, Environment, Filter, HistoryEntry, MongoOverview, Role, SavedQuery, SchemaColumn, Table } from './types';

/** What the footer shows for the active tab. `browse` marks a table tab, whose session is read-only whatever the profile allows. */
export interface Status { role: Role; host: string; detail: string; readOnly: boolean; browse?: boolean }

/** Every tab follows the workspace environment unless `pin` holds its own. */
type Tab = { key: string; conn: string; pin?: EnvId } & (
  | { kind: 'table'; schema: string; table: string; filters?: Filter[] }
  // `sql` is the editor's text; `saved` and `name` link the tab to a saved query.
  | { kind: 'query'; n: number; sql: string; saved?: string; name?: string }
  | { kind: 'collection'; db: string; collection: string }
);
type Theme = 'system' | 'light' | 'dark';
type Loaded<T> = T | DbError | 'loading';

// Per-viewer conveniences only; the workspace itself lives in the Rust side.
const pref = {
  get: (k: string) => { try { return localStorage.getItem(`berth-${k}`); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`berth-${k}`, v); } catch { /* storage may be unavailable */ } },
};

const byName = (a: SavedQuery, b: SavedQuery) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
/** How many recent runs the sidebar lists; the history dialog shows the rest. */
const RECENT = 15;

const isError = (v: unknown): v is DbError => typeof v === 'object' && v !== null && 'message' in v && !Array.isArray(v);

function Dot({ env, off }: { env?: Environment; off?: boolean }) {
  return <i className="dot" data-off={off || !env || undefined} style={!off && env ? { background: env.color } : undefined} />;
}

export function App() {
  const [envs, setEnvs] = useState<Environment[]>(DEFAULT_ENVIRONMENTS);
  const [conns, setConns] = useState<Connection[]>([]);
  const [env, setEnvState] = useState<EnvId>(() => pref.get('env') || 'dev');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tables, setTables] = useState<Record<string, Loaded<Table[]>>>({});
  const [overviews, setOverviews] = useState<Record<string, Loaded<MongoOverview>>>({});
  const [collections, setCollections] = useState<Record<string, Loaded<CollectionInfo[]>>>({});
  /** Every readable column per connection and environment, for SQL completion. */
  const [schemaCache, setSchemaCache] = useState<Record<string, Loaded<SchemaColumn[]>>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ conn: Connection | null; env: EnvId } | null>(null);
  const [envSheet, setEnvSheet] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (pref.get('theme') as Theme) || 'system');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const filtering = filter.trim().length > 0;
  // Until the workspace is read, show a loading row instead of an empty workspace or default environments.
  const [ready, setReady] = useState(false);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [historyFor, setHistoryFor] = useState<{ conn: string | null; tab?: string } | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ title: string; body: ReactNode; action: string; run: () => Promise<void> } | null>(null);
  const [inject, setInject] = useState<{ tab: string; sql: string; seq: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback((text: string, bad?: boolean) => {
    clearTimeout(toastTimer.current);
    setToast({ text, bad });
    toastTimer.current = setTimeout(() => setToast(null), bad ? 6000 : 3500);
  }, []);
  const refreshRecent = useCallback(() => { api.listHistory(null, null, RECENT).then(setRecent).catch(() => {}); }, []);
  const saveActive = useRef<() => void>(() => {});
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    Promise.all([api.listEnvironments(), api.listConnections(), api.listSavedQueries()])
      .then(([e, c, q]) => {
        setEnvs(e);
        setConns(c);
        setSavedQueries(q);
        if (!findEnv(e, env)) setEnvState(e[0].id);
        if (c.length === 1) setOpen({ [c[0].id]: true });
      })
      .catch((e: DbError) => setLoadError(e.message ?? String(e)))
      .finally(() => setReady(true));
    refreshRecent();
    // Loaded once at start; later changes come back from the sheets.
  }, []);
  // ⌘P (Ctrl+P elsewhere) jumps to the sidebar filter; without preventDefault the webview would print.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      } else if (k === 's') {
        e.preventDefault();
        saveActive.current();
      } else if (k === 'k') {
        e.preventDefault();
        setPalette(p => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    pref.set('theme', theme);
  }, [theme]);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const dark = theme === 'system' ? systemDark : theme === 'dark';
  // One button flips light and dark; landing back on the system's own theme follows macOS again.
  const toggleTheme = () => setTheme(dark === systemDark ? (dark ? 'light' : 'dark') : 'system');

  const setEnv = (e: EnvId) => { setEnvState(e); pref.set('env', e); setStatus(null); };
  const workspaceEnv = findEnv(envs, env) ?? envs[0];

  // Load what the sidebar shows for every expanded connection in the workspace environment.
  useEffect(() => {
    for (const c of conns) {
      const k = `${c.id}|${env}`;
      if (!open[c.id] || !c.profiles[env]) continue;
      if (c.engine === 'postgres' && !tables[k]) {
        setTables(t => ({ ...t, [k]: 'loading' }));
        api.listTables(c.id, env).then(list => setTables(t => ({ ...t, [k]: list }))).catch((e: DbError) => setTables(t => ({ ...t, [k]: e })));
      }
      if (c.engine === 'mongodb' && !overviews[k]) {
        setOverviews(o => ({ ...o, [k]: 'loading' }));
        api.mongoOverview(c.id, env).then(v => setOverviews(o => ({ ...o, [k]: v }))).catch((e: DbError) => setOverviews(o => ({ ...o, [k]: e })));
      }
    }
  }, [conns, env, open, tables, overviews]);

  // The active query tab's connection gets its schema cache, once per connection and environment.
  const activeTab = tabs.find(t => t.key === active);
  const schemaKey = activeTab?.kind === 'query' ? `${activeTab.conn}|${effectiveEnv(envs, env, activeTab.pin)}` : null;
  useEffect(() => {
    if (!schemaKey || schemaCache[schemaKey]) return;
    const [conn, e] = schemaKey.split('|');
    if (!conns.find(c => c.id === conn)?.profiles[e]) return;
    setSchemaCache(m => ({ ...m, [schemaKey]: 'loading' }));
    api.schemaColumns(conn, e).then(v => setSchemaCache(m => ({ ...m, [schemaKey]: v }))).catch((x: DbError) => setSchemaCache(m => ({ ...m, [schemaKey]: x })));
  }, [schemaKey, schemaCache, conns]);
  /** After a run: the history gains it, and DDL makes the sidebar and the completion cache stale. */
  const onRan = useCallback((sql: string, k: string) => {
    refreshRecent();
    if (/^\s*(create|alter|drop|comment|truncate)\b/im.test(sql.replace(/--.*$/gm, ''))) {
      const drop = <T,>(m: Record<string, T>) => { const { [k]: _, ...rest } = m; return rest; };
      setSchemaCache(drop);
      setTables(drop);
    }
  }, [refreshRecent]);

  const toggleDb = (c: Connection, db: string) => {
    const k = `${c.id}|${env}|${db}`;
    const next = !open[k];
    setOpen({ ...open, [k]: next });
    if (next && !collections[k]) {
      setCollections(x => ({ ...x, [k]: 'loading' }));
      api.listCollections(c.id, env, db).then(v => setCollections(x => ({ ...x, [k]: v }))).catch((e: DbError) => setCollections(x => ({ ...x, [k]: e })));
    }
  };

  const openTab = (t: Tab) => { setTabs(ts => (ts.some(x => x.key === t.key) ? ts : [...ts, t])); setActive(t.key); };
  /** A table opened by following a foreign key gets its own tab, keyed by its chips, so the plain tab stays. */
  const openTable = (conn: string, schema: string, table: string, filters?: Filter[]) => {
    const base = `t|${conn}|${schema}.${table}`;
    const chips = filters?.length ? filters : undefined;
    openTab({ key: chips ? `${base}|${chips.map(filterText).join(' & ')}` : base, kind: 'table', conn, schema, table, filters: chips });
  };
  const nextQueryN = () => tabs.filter(t => t.kind === 'query').length + 1;
  const newQuery = (conn: string, sql = START) => openTab({ key: `q|${conn}|${Date.now()}`, kind: 'query', conn, n: nextQueryN(), sql });
  const patchQuery = (key: string, patch: { sql?: string; saved?: string; name?: string }) =>
    setTabs(ts => ts.map(t => (t.key === key && t.kind === 'query' ? { ...t, ...patch } : t)));
  const openSaved = (q: SavedQuery) => {
    const open = tabs.find(t => t.kind === 'query' && t.saved === q.id);
    if (open) setActive(open.key);
    else openTab({ key: `s|${q.id}`, kind: 'query', conn: q.conn, n: nextQueryN(), sql: q.sql, saved: q.id, name: q.name });
  };
  /** Saves a query tab: in place when it came from a saved query, otherwise after asking for a name. */
  const saveTab = async (key: string, name?: string) => {
    const t = tabs.find(x => x.key === key);
    if (!t || t.kind !== 'query') return;
    const existing = t.saved ? savedQueries.find(q => q.id === t.saved) : undefined;
    if (!existing && name === undefined) { setNaming(key); return; }
    try {
      const q = await api.saveQuery({ id: existing?.id ?? '', name: name ?? existing?.name ?? '', conn: t.conn, sql: t.sql });
      setSavedQueries(qs => [...qs.filter(x => x.id !== q.id), q].sort(byName));
      patchQuery(key, { saved: q.id, name: q.name });
      flash(`Saved ${q.name}`);
    } catch (e) {
      flash((e as DbError).message, true);
    }
  };
  saveActive.current = () => { if (active?.startsWith('q|') || active?.startsWith('s|')) saveTab(active); };
  const deleteSaved = (q: SavedQuery) => setAsk({
    title: 'Delete this saved query?',
    body: <><b>{q.name}</b> is removed from the workspace. An open tab keeps its text.</>,
    action: 'Delete',
    run: async () => {
      await api.deleteSavedQuery(q.id);
      setSavedQueries(qs => qs.filter(x => x.id !== q.id));
      setTabs(ts => ts.map(t => (t.kind === 'query' && t.saved === q.id ? { ...t, saved: undefined } : t)));
    },
  });
  const clearHistory = (conn: string | null) => setAsk({
    title: conn ? `Clear the history of ${conn}?` : 'Clear all query history?',
    body: 'The statements are deleted from this Mac. Saved queries stay.',
    action: 'Clear history',
    run: async () => { await api.clearHistory(conn); refreshRecent(); setHistoryFor(null); },
  });
  const closeTab = (key: string) => {
    setTabs(ts => {
      const i = ts.findIndex(t => t.key === key);
      const next = ts.filter(t => t.key !== key);
      if (active === key) setActive(next[Math.min(i, next.length - 1)]?.key ?? null);
      return next;
    });
  };
  const pinTab = (key: string, pin: EnvId | undefined) => { setTabs(ts => ts.map(t => (t.key === key ? { ...t, pin } : t))); setStatus(null); };
  const onStatus = useCallback((s: Status) => setStatus(s), []);

  const tab = tabs.find(t => t.key === active) ?? null;
  const tabEnvId = tab ? effectiveEnv(envs, env, tab.pin) : env;
  const tabEnv = findEnv(envs, tabEnvId) ?? workspaceEnv;
  const tabConn = tab ? conns.find(c => c.id === tab.conn) : undefined;
  const profile = tabConn?.profiles[tabEnvId];
  const production = tabEnv.production;

  const saved = (c: Connection) => {
    setConns(cs => [...cs.filter(x => x.id !== c.id), c].sort((a, b) => a.id.localeCompare(b.id)));
    const drop = <T,>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${c.id}|`)));
    setTables(drop); setOverviews(drop); setCollections(drop); setSchemaCache(drop);
    setOpen(o => ({ ...o, [c.id]: true }));
    setSheet(null);
  };
  const deleted = (id: string) => {
    setConns(cs => cs.filter(c => c.id !== id));
    setTabs(ts => ts.filter(t => t.conn !== id));
    setSheet(null);
  };
  const envsSaved = async (next: Environment[]) => {
    setEnvs(next);
    if (!findEnv(next, env)) setEnv(next[0].id);
    setTabs(ts => ts.map(t => (t.pin && !findEnv(next, t.pin) ? { ...t, pin: undefined } : t)));
    setTables({}); setOverviews({}); setCollections({}); setSchemaCache({});
    setConns(await api.listConnections());
    setEnvSheet(false);
  };

  // Sidebar sections below the connections. "+" opens a query on the tab's connection, or the first one that can.
  const sqlConns = conns.filter(c => c.engine === 'postgres' && c.profiles[env]);
  const queryConn = tabConn?.engine === 'postgres' && tabConn.profiles[env] ? tabConn.id : sqlConns[0]?.id;
  const shownSaved = savedQueries.filter(q => !filtering || matchesFilter(filter, q.name, q.conn));
  const shownRecent = recent.filter(e => !filtering || matchesFilter(filter, sqlSummary(e.sql), e.conn));
  const secOpen = (id: string) => open[`sec:${id}`] !== false || filtering;
  const toggleSec = (id: string) => setOpen(o => ({ ...o, [`sec:${id}`]: !secOpen(id) }));
  const activeSaved = tab?.kind === 'query' ? tab.saved : undefined;

  /** What ⌘K offers: everything the sidebar has loaded, plus the app's actions. */
  const paletteItems = (): PaletteItem[] => {
    const items: PaletteItem[] = [];
    for (const c of conns) {
      const list = tables[`${c.id}|${env}`];
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        items.push({ group: 'Tables', icon: t.kind === 'table' ? 'table' : 'view', label: t.name, sub: `${t.schema} · ${c.id}`, run: () => openTable(c.id, t.schema, t.name) });
      }
    }
    for (const [k, list] of Object.entries(collections)) {
      const [conn, e, db] = k.split('|');
      if (e !== env || !Array.isArray(list)) continue;
      for (const col of list) {
        items.push({ group: 'Collections', icon: 'leaf', label: col.name, sub: `${db} · ${conn}`,
          run: () => openTab({ key: `m|${conn}|${db}.${col.name}`, kind: 'collection', conn, db, collection: col.name }) });
      }
    }
    for (const q of savedQueries) items.push({ group: 'Saved queries', icon: 'bookmark', label: q.name, sub: q.conn, run: () => openSaved(q) });
    for (const c of conns) {
      if (!c.profiles[env]) continue;
      if (c.engine === 'postgres') items.push({ group: 'Connections', icon: 'code', label: `New query on ${c.id}`, sub: workspaceEnv.label, run: () => newQuery(c.id) });
      items.push({ group: 'Connections', icon: c.engine === 'mongodb' ? 'leaf' : 'db', label: `Browse ${c.id}`, sub: 'opens it in the sidebar', run: () => setOpen(o => ({ ...o, [c.id]: true })) });
    }
    if (tab?.kind === 'query') items.push({ group: 'Actions', icon: 'bookmark', label: 'Save this query', sub: '⌘S', run: () => saveTab(tab.key) });
    items.push(
      { group: 'Actions', icon: 'plus', label: 'New connection', run: () => setSheet({ conn: null, env }) },
      { group: 'Actions', icon: 'gear', label: 'Edit environments', run: () => setEnvSheet(true) },
      ...envs.filter(e => e.id !== env).map(e => ({ group: 'Actions', icon: 'db', label: `Switch to ${e.label}`, sub: e.production ? 'production, opens read-only' : undefined, run: () => setEnv(e.id) })),
      { group: 'Actions', icon: dark ? 'sun' : 'moon', label: 'Toggle light / dark', sub: dark ? 'now dark' : 'now light', run: toggleTheme },
      { group: 'Actions', icon: 'clock', label: 'Query history', run: () => setHistoryFor({ conn: null }) },
      { group: 'Actions', icon: 'search', label: 'Filter the sidebar', sub: '⌘P', run: () => setTimeout(() => filterRef.current?.focus()) },
    );
    return items;
  };

  const envControl = tab && (
    <label className={`target envpin${tab.pin ? ' pinned' : ''}`} title="Which environment this tab uses">
      <Dot env={tabEnv} />
      <select value={tab.pin ?? ''} onChange={e => pinTab(tab.key, e.target.value || undefined)} aria-label="Environment for this tab">
        <option value="">Follows workspace · {workspaceEnv.label}</option>
        {envs.map(e => <option key={e.id} value={e.id}>Pinned to {e.label}{e.production ? ' (production)' : ''}</option>)}
      </select>
    </label>
  );

  return (
    <div className={`app${production ? ' prod' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region><Mark size={16} />Berth Studio</span>
        <span className="spacer" data-tauri-drag-region />
        {!ready ? <Spinner label="Loading environments" /> : envs.length <= 5 ? (
          <div className="seg" role="group" aria-label="Workspace environment">
            {envs.map(e => (
              <button key={e.id} aria-pressed={env === e.id} onClick={() => setEnv(e.id)} title={e.production ? `${e.label} is a production environment` : undefined}>
                <Dot env={e} />{e.label}
              </button>
            ))}
          </div>
        ) : (
          <label className="target"><Dot env={workspaceEnv} />
            <select value={env} onChange={e => setEnv(e.target.value)} aria-label="Workspace environment">
              {envs.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </label>
        )}
        <button className="iconbtn" aria-label="Edit environments" title="Edit environments" onClick={() => setEnvSheet(true)}><Icon name="gear" /></button>
        <span className="sep" aria-hidden />
        <button className={`iconbtn themebtn${theme === 'system' ? '' : ' override'}`} onClick={toggleTheme}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={`${dark ? 'Switch to light mode' : 'Switch to dark mode'} · ${theme === 'system' ? 'now following system' : `system is ${systemDark ? 'dark' : 'light'}`}`}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        <UpdateButton />
      </div>

      <div className="body">
        <aside className="side" aria-label="Connections">
          <div className="side-head">
            Connections
            <button className="iconbtn" aria-label="New connection" title="New connection" onClick={() => setSheet({ conn: null, env })}><Icon name="plus" /></button>
          </div>
          <div className="side-tools">
            <label className="side-filter">
              <Icon name="search" size={12} />
              <input ref={filterRef} value={filter} placeholder="Filter" aria-label="Filter the sidebar" spellCheck={false}
                onChange={e => setFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setFilter(''); e.currentTarget.blur(); } }} />
              <kbd>⌘P</kbd>
            </label>
          </div>
          <div className="side-scroll" role="tree">
            {loadError && <div className="msg error">{loadError}</div>}
            {!ready && <TreeNote loading>Loading workspace…</TreeNote>}
            {conns.map(c => {
              const p = c.profiles[env];
              const k = `${c.id}|${env}`;
              const list = tables[k];
              const overview = overviews[k];
              const groups = Array.isArray(list) ? groupBySchema(list) : [];
              const dbs = overview && overview !== 'loading' && !isError(overview) ? overview.databases : [];
              const collNames = (db: string) => { const cl = collections[`${k}|${db}`]; return Array.isArray(cl) ? cl.map(x => x.name) : []; };
              // With a filter, a connection shows when it or anything loaded inside it matches, and it opens by itself.
              const inside = [...groups.flatMap(g => [g.schema, ...g.tables.map(t => t.name)]), ...dbs, ...dbs.flatMap(collNames)];
              if (filtering && !matchesFilter(filter, c.id, ...inside)) return null;
              const isOpen = !!p && (!!open[c.id] || filtering);
              return (
                <div key={c.id} role="treeitem" aria-expanded={isOpen}>
                  <div className={`node conn${p ? '' : ' missing'}${isOpen ? ' open' : ''}`}>
                    <button className="node-btn" onClick={() => (p ? setOpen({ ...open, [c.id]: !open[c.id] }) : setSheet({ conn: c, env }))}
                      title={p ? undefined : `${c.id} has no ${workspaceEnv.label} profile. Click to set it up.`}>
                      <span className="tw"><Icon name="chev" size={12} /></span>
                      <Icon name={c.engine === 'mongodb' ? 'leaf' : 'db'} />
                      <span className="lbl">{c.id}</span>
                      {p ? <span className="dots" aria-label="Environments">{envs.map(e => <Dot key={e.id} env={e} off={!c.profiles[e.id]} />)}</span>
                        : <span className="meta">not in {workspaceEnv.label}</span>}
                    </button>
                    <span className="acts">
                      {c.engine === 'postgres' && p && (
                        <button className="iconbtn always" aria-label={`New query on ${c.id}`} title="New query" onClick={() => newQuery(c.id)}><Icon name="code" size={14} /></button>
                      )}
                      <button className="iconbtn" aria-label={`Edit the profiles of ${c.id}`} title="Edit profiles" onClick={() => setSheet({ conn: c, env })}><Icon name="gear" size={14} /></button>
                    </span>
                  </div>
                  {isOpen && (
                    <div role="group" className="tree-inner">
                      {c.engine === 'postgres' && list === 'loading' && <TreeNote depth="lvl1" loading>Loading tables…</TreeNote>}
                      {c.engine === 'postgres' && Array.isArray(list) && !list.length && <TreeNote depth="lvl1">No tables or views you can read</TreeNote>}
                      {c.engine === 'postgres' && isError(list) && <TreeNote depth="lvl1" error={list.message}>{list.message}</TreeNote>}
                      {c.engine === 'postgres' && groups.map(g => {
                        const sk = `${k}|${g.schema}`;
                        const shown = filtering && !matchesFilter(filter, g.schema) ? g.tables.filter(t => matchesFilter(filter, t.name)) : g.tables;
                        if (filtering && !shown.length) return null;
                        const schemaOpen = open[sk] !== false || filtering;
                        return (
                          <div key={sk} role="treeitem" aria-expanded={schemaOpen}>
                            <button className={`node lvl1${schemaOpen ? ' open' : ''}`} onClick={() => setOpen({ ...open, [sk]: !schemaOpen })}>
                              <span className="tw"><Icon name="chev" size={12} /></span>
                              <Icon name="schema" />
                              <span className="lbl">{g.schema}</span>
                              <span className="meta">{g.tables.length}</span>
                            </button>
                            {schemaOpen && (
                              <div role="group" className="tree-inner">
                                {shown.map(t => {
                                  const key = `t|${c.id}|${t.schema}.${t.name}`;
                                  return (
                                    <button key={key} className={`node lvl2${active === key ? ' active' : ''}`} onClick={() => openTable(c.id, t.schema, t.name)}>
                                      <Icon name={t.kind === 'table' ? 'table' : 'view'} />
                                      <span className="lbl">{t.name}</span>
                                      <span className="meta">{t.estimatedRows >= 0 ? compact(t.estimatedRows) : ''}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {c.engine === 'mongodb' && overview === 'loading' && <TreeNote depth="lvl1" loading>Connecting…</TreeNote>}
                      {c.engine === 'mongodb' && isError(overview) && <TreeNote depth="lvl1" error={overview.message}>{overview.message}</TreeNote>}
                      {c.engine === 'mongodb' && overview && overview !== 'loading' && !isError(overview) && (
                        <>
                          {!filtering && <div className="node lvl1 missing"><Icon name="leaf" /><span className="lbl">MongoDB {overview.server.version} · {overview.server.topology}</span></div>}
                          {!overview.databases.length && <TreeNote depth="lvl1">No databases you can read</TreeNote>}
                          {overview.databases.map(db => {
                            const dk = `${k}|${db}`;
                            const colls = collections[dk];
                            const dbMatches = matchesFilter(filter, db);
                            if (filtering && !dbMatches && !collNames(db).some(n => matchesFilter(filter, n))) return null;
                            const dbOpen = !!open[dk] || (filtering && !dbMatches);
                            return (
                              <div key={db} role="treeitem" aria-expanded={dbOpen}>
                                <button className={`node lvl1${dbOpen ? ' open' : ''}`} onClick={() => toggleDb(c, db)}>
                                  <span className="tw"><Icon name="chev" size={12} /></span><Icon name="db" /><span className="lbl">{db}</span>
                                </button>
                                {dbOpen && (
                                  <div role="group" className="tree-inner">
                                    {colls === 'loading' && <TreeNote depth="lvl2" loading>Loading collections…</TreeNote>}
                                    {Array.isArray(colls) && !colls.length && <TreeNote depth="lvl2">No collections</TreeNote>}
                                    {isError(colls) && <TreeNote depth="lvl2" error={colls.message}>{colls.message}</TreeNote>}
                                    {Array.isArray(colls) && colls.filter(col => !filtering || dbMatches || matchesFilter(filter, col.name)).map(col => {
                                      const key = `m|${c.id}|${db}.${col.name}`;
                                      return (
                                        <button key={key} className={`node lvl2${active === key ? ' active' : ''}`}
                                          onClick={() => openTab({ key, kind: 'collection', conn: c.id, db, collection: col.name })}>
                                          <Icon name={col.kind === 'view' ? 'view' : 'table'} />
                                          <span className="lbl">{col.name}</span>
                                          <span className="meta">{col.kind === 'view' ? 'view' : col.count !== undefined ? compact(col.count) : ''}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtering && ready && conns.length > 0 && !shownSaved.length && !shownRecent.length && !conns.some(c => {
              const k = `${c.id}|${env}`;
              const list = tables[k];
              const names = Array.isArray(list) ? list.flatMap(t => [t.schema, t.name]) : [];
              return matchesFilter(filter, c.id, ...names);
            }) && <TreeNote>Nothing matches “{filter.trim()}”</TreeNote>}
            {ready && !conns.length && !loadError && (
              <div className="empty">
                <h3>No connections yet</h3>
                <p>Add a PostgreSQL or MongoDB connection with a profile for each environment.</p>
                <button className="btn primary" onClick={() => setSheet({ conn: null, env })}><Icon name="plus" />New connection</button>
              </div>
            )}

            {ready && (!filtering || shownSaved.length > 0) && (
              <section className="side-sec" aria-label="Saved queries">
                <div className="sec-head">
                  <button className="sec-toggle" aria-expanded={secOpen('saved')} onClick={() => toggleSec('saved')}>
                    <span className="tw"><Icon name="chevd" size={12} /></span><Icon name="bookmark" size={13} />Saved queries<span className="cnt">{savedQueries.length}</span>
                  </button>
                  <button className="iconbtn" aria-label="New query" title={queryConn ? `New query on ${queryConn}` : 'Add a PostgreSQL connection first'} disabled={!queryConn}
                    onClick={() => queryConn && newQuery(queryConn)}><Icon name="plus" /></button>
                </div>
                {secOpen('saved') && (shownSaved.length ? shownSaved.map(q => (
                  <div key={q.id} className={`node conn${activeSaved === q.id ? ' active' : ''}`}>
                    <button className="node-btn" onClick={() => openSaved(q)} title={`${q.name} · ${q.conn}`}>
                      <Icon name="code" /><span className="lbl">{q.name}</span><span className="meta">{q.conn}</span>
                    </button>
                    <span className="acts">
                      <button className="iconbtn" aria-label={`Delete ${q.name}`} title="Delete" onClick={() => deleteSaved(q)}><Icon name="trash" size={14} /></button>
                    </span>
                  </div>
                )) : <TreeNote>Save a query tab with ⌘S to keep it here.</TreeNote>)}
              </section>
            )}

            {ready && (!filtering || shownRecent.length > 0) && (
              <section className="side-sec" aria-label="History">
                <div className="sec-head">
                  <button className="sec-toggle" aria-expanded={secOpen('history')} onClick={() => toggleSec('history')}>
                    <span className="tw"><Icon name="chevd" size={12} /></span><Icon name="clock" size={13} />History
                  </button>
                  <button className="iconbtn" aria-label="Show all history" title="Show all history" onClick={() => setHistoryFor({ conn: null })}><Icon name="search" size={14} /></button>
                </div>
                {secOpen('history') && (shownRecent.length ? <>
                  {shownRecent.map((e, i) => (
                    <button key={`${e.at}-${i}`} className="node hist" onClick={() => newQuery(e.conn, e.sql)}
                      title={`${e.conn} · ${e.env} · ${e.error ? `failed: ${e.error}` : `${e.rows.toLocaleString('en-US')} rows`} · ${e.elapsedMs} ms\n\n${e.sql}`}>
                      <i className={`hdot${e.error ? ' bad' : ''}`} />
                      <span className="lbl mono">{sqlSummary(e.sql)}</span>
                      <span className="meta">{clockTime(e.at)}</span>
                    </button>
                  ))}
                  {!filtering && <button className="node more" onClick={() => setHistoryFor({ conn: null })}>Show all…</button>}
                </> : <TreeNote>Statements you run show here.</TreeNote>)}
              </section>
            )}
          </div>
          <div className="side-foot">
            <button className="side-palette" onClick={() => setPalette(true)} title="Search tables, queries and actions">
              <Icon name="terminal" size={14} />Command palette<kbd>⌘K</kbd>
            </button>
          </div>
        </aside>

        <main className="main">
          {tabs.length > 0 && (
            <div className="tabs" role="tablist">
              {tabs.map(t => {
                const te = findEnv(envs, effectiveEnv(envs, env, t.pin));
                return (
                  <div key={t.key} className={`tab${te?.production ? ' prod-tab' : ''}`} role="tab" aria-selected={t.key === active} onClick={() => setActive(t.key)}>
                    <Icon name={t.kind === 'query' ? 'code' : t.kind === 'collection' ? 'leaf' : 'table'} size={14} />
                    <span className="lbl">{t.kind === 'table' ? t.table : t.kind === 'collection' ? t.collection : t.name ?? `Query ${t.n}`}</span>
                    {t.kind === 'query' && t.saved && savedQueries.find(q => q.id === t.saved)?.sql !== t.sql && <span className="unsaved" title="Changed since it was saved">•</span>}
                    <span className="faint">{t.conn}</span>
                    {t.kind === 'table' && t.filters && <span className="pin-badge filtered" title={t.filters.map(filterText).join(' and ')}><Icon name="filter" size={10} />filtered</span>}
                    {t.pin && <span className="pin-badge" title={`Pinned to ${te?.label}`}><Dot env={te} />{te?.label}</span>}
                    <button className="x" aria-label="Close tab" onClick={e => { e.stopPropagation(); closeTab(t.key); }}><Icon name="x" size={12} /></button>
                  </div>
                );
              })}
            </div>
          )}
          {!tab ? (
            <div className="gate">
              <Mark size={40} />
              <h2>Berth Studio</h2>
              <p>Pick a table or collection in the sidebar, or open a new query. The environment switch at the top changes every connection at once; a tab can also be pinned to its own environment.</p>
            </div>
          ) : !profile ? (
            <div className="gate">
              <h2>{tab.conn} has no {tabEnv.label} profile</h2>
              <p>Each environment can point at its own host, database and credentials.</p>
              <div className="acts">
                <button className="btn primary" onClick={() => setSheet({ conn: tabConn ?? null, env: tabEnvId })}>Set up {tabEnv.label}</button>
                {tab.pin && <button className="btn" onClick={() => pinTab(tab.key, undefined)}>Follow the workspace</button>}
              </div>
            </div>
          ) : tab.kind === 'table' ? (
            <TableView key={`${tab.key}|${tabEnvId}`} conn={tab.conn} env={tabEnvId} envLabel={tabEnv.label} schema={tab.schema} table={tab.table} envControl={envControl} onStatus={onStatus}
              onOpenTable={(s, t, f) => openTable(tab.conn, s, t, f)} initialFilters={tab.filters} />
          ) : tab.kind === 'collection' ? (
            <CollectionView key={`${tab.key}|${tabEnvId}`} conn={tab.conn} env={tabEnvId} envLabel={tabEnv.label} db={tab.db} collection={tab.collection}
              readOnly={profile.readOnly || tabEnv.production} canWrite={!profile.readOnly || tabEnv.production} envControl={envControl} onStatus={onStatus} />
          ) : (
            <div className="pane" key={tab.key}>
              <QueryView conn={tab.conn} env={tabEnvId} envLabel={tabEnv.label} hasRead={hasRead(profile)} hasWrite={hasWrite(profile)} envControl={envControl} onStatus={onStatus}
                initialSql={tab.sql} onRan={sql => onRan(sql, `${tab.conn}|${tabEnvId}`)}
                schema={(c => (Array.isArray(c) ? c : null))(schemaCache[`${tab.conn}|${tabEnvId}`])} title={tab.name ?? `query-${tab.n}`} onSave={() => saveTab(tab.key)} onHistory={() => setHistoryFor({ conn: tab.conn, tab: tab.key })}
                // An insert from the history is done once the editor's text changes.
                inject={inject?.tab === tab.key ? inject : null}
                onChange={sql => { patchQuery(tab.key, { sql }); if (inject?.tab === tab.key) setInject(null); }} />
            </div>
          )}
        </main>
      </div>

      <footer className="status">
        <span className="prodtag">PRODUCTION</span>
        <span><Dot env={tabEnv} /> {tab ? `${tab.conn} · ${tabEnv.label}${tab.pin ? ' (pinned)' : ''}` : workspaceEnv.label}</span>
        {status && tab && <><span>{status.browse ? 'browse' : status.role} · <span className="mono">{status.host}</span></span><span>{status.detail}</span></>}
        <span className="grow" />
        {status && tab && (
          <span>
            {status.browse ? browseStatus(profile, production, false)
              : status.readOnly ? 'read-only session' : production ? 'wrote once; the next query is read-only again' : 'read-write session'}
          </span>
        )}
        <span className="faint">{production ? 'Production opens read-only' : tabConn?.engine === 'mongodb' ? 'MongoDB' : 'PostgreSQL'}</span>
      </footer>

      {sheet && <ConnectionSheet existing={sheet.conn} startEnv={sheet.env} environments={envs} onClose={() => setSheet(null)} onSaved={saved} onDeleted={deleted} />}
      {envSheet && <EnvironmentsSheet environments={envs} onClose={() => setEnvSheet(false)} onSaved={envsSaved} />}
      {historyFor && (
        <HistoryDialog connections={sqlConns.map(c => c.id)} conn={historyFor.conn} onClose={() => setHistoryFor(null)} onClear={clearHistory}
          onOpen={e => { setHistoryFor(null); newQuery(e.conn, e.sql); }}
          onInsert={historyFor.tab ? e => { const t = historyFor.tab!; setHistoryFor(null); setActive(t); setInject({ tab: t, sql: e.sql, seq: Date.now() }); } : undefined} />
      )}
      {naming && (
        <PromptDialog title="Save query" label="Name, shown in the sidebar" action="Save" initial={(t => `query-${t?.kind === 'query' ? t.n : 1}.sql`)(tabs.find(t => t.key === naming))}
          onCancel={() => setNaming(null)} onSubmit={name => { const key = naming; setNaming(null); saveTab(key, name); }} />
      )}
      {ask && (
        <AskDialog title={ask.title} action={ask.action} onCancel={() => setAsk(null)}
          onConfirm={() => { const a = ask; setAsk(null); a.run().catch((e: DbError) => flash(e.message, true)); }}>{ask.body}</AskDialog>
      )}
      {palette && <CommandPalette items={paletteItems()} onClose={() => setPalette(false)} />}
      {toast && <div className={`toast${toast.bad ? ' bad' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}

