// One PostgreSQL table: a filtered, sorted page of rows. Filters are chips (column, operator,
// value) that the Rust side binds as parameters, plus an optional raw WHERE condition; both run
// as a single prepared statement on a read-only session.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { Grid } from './Grid';
import { Icon } from './Icons';
import { Placeholder, Spinner } from './Status';
import { OPS, filterText, findRows, nextSort, parseInValues, rowCountText } from './logic';
import type { BrowseRequest, DbError, EnvId, Filter, FilterOp, Page, RowCount, Sort } from './types';
import type { Status } from './App';

const PAGE = 200;

interface Props {
  conn: string;
  env: EnvId;
  envLabel: string;
  schema: string;
  table: string;
  envControl: ReactNode;
  onStatus: (s: Status) => void;
}

type Draft = { column: string; op: FilterOp; value: string };

export function TableView({ conn, env, envLabel, schema, table, envControl, onStatus }: Props) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<DbError | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [filters, setFilters] = useState<Filter[]>([]);
  // The condition in force, and the one being typed; Apply (or Enter) moves the draft across.
  const [where, setWhere] = useState('');
  const [whereDraft, setWhereDraft] = useState('');
  const [showWhere, setShowWhere] = useState(false);
  const [sort, setSort] = useState<Sort | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [count, setCount] = useState<RowCount | null>(null);
  const [find, setFind] = useState('');
  const countedFor = useRef('');

  const request = useCallback((limit: number, at: number): BrowseRequest => ({ filters, where: where.trim() || null, sort, limit, offset: at }), [filters, where, sort]);
  const filtered = filters.length > 0 || where.trim().length > 0;

  useEffect(() => setOffset(0), [conn, env, schema, table, filters, where, sort]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const req = request(PAGE, offset);
    api.browseTable(conn, env, schema, table, req)
      .then(p => {
        if (!live) return;
        setPage(p);
        setError(null);
        // Browsing reads through a read-only session whatever the profile allows; the footer says what the profile allows.
        onStatus({ role: 'read', host: p.host, detail: `${p.rows.length} rows · ${p.elapsedMs} ms`, readOnly: true, browse: true });
        // The count is a second query, so it runs once per filter set rather than once per page.
        const key = JSON.stringify([conn, env, schema, table, req.filters, req.where, nonce]);
        if (countedFor.current !== key) {
          countedFor.current = key;
          setCount(null);
          api.countRows(conn, env, schema, table, { ...req, sort: null, limit: 1, offset: 0 })
            .then(c => countedFor.current === key && setCount(c))
            .catch(() => countedFor.current === key && setCount(null));
        }
      })
      .catch((e: DbError) => live && (setError(e), setPage(null)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [conn, env, schema, table, offset, nonce, request, onStatus]);

  const hits = useMemo(() => (page ? findRows(page.rows, find) : []), [page, find]);
  const finding = find.trim().length > 0;
  const atEnd = !page || page.rows.length < PAGE || (!!count?.exact && count.total !== null && offset + PAGE >= count.total);

  const startDraft = () => setDraft({ column: page?.columns[0]?.name ?? '', op: 'eq', value: '' });
  const addFilter = () => {
    if (!draft || !draft.column) return;
    const op = OPS.find(o => o.op === draft.op);
    if (!op) return;
    const f: Filter = op.op === 'in' ? { column: draft.column, op: 'in', values: parseInValues(draft.value) }
      : op.needsValue ? { column: draft.column, op: draft.op, value: draft.value } : { column: draft.column, op: draft.op };
    if (op.op === 'in' && !f.values?.length) return;
    setFilters([...filters, f]);
    setDraft(null);
  };
  const applyWhere = () => { setWhere(whereDraft); if (!whereDraft.trim()) setShowWhere(false); };
  const clearAll = () => { setFilters([]); setWhere(''); setWhereDraft(''); setSort(null); setFind(''); setDraft(null); };
  const needsValue = draft ? OPS.find(o => o.op === draft.op)?.needsValue : false;

  return (
    <div className="pane">
      <div className="toolbar">
        <span className="crumb">
          <Icon name="db" size={12} /><span>{conn} · {envLabel}</span>
          <Icon name="chev" size={12} /><span>{schema}</span>
          <Icon name="chev" size={12} /><b>{table}</b>
        </span>
        <span className="grow" />
        {envControl}
        {loading && page && <Spinner label="Loading rows" />}
        <button className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
        <button className="btn" disabled={atEnd || loading} onClick={() => setOffset(offset + PAGE)}>Next</button>
        <button className="btn" disabled={loading} onClick={() => setNonce(n => n + 1)} title="Reload this page of rows"><Icon name="refresh" size={14} />Refresh</button>
      </div>

      <form className="filters" onSubmit={e => { e.preventDefault(); if (draft) addFilter(); else applyWhere(); }} aria-label="Filters">
        <span className="faint" title="Filters run as bound parameters"><Icon name="filter" size={14} /></span>
        {filters.map((f, i) => (
          <span key={`${filterText(f)}|${i}`} className="chip filter-chip">
            <span className="mono">{filterText(f)}</span>
            <button type="button" aria-label={`Remove filter ${filterText(f)}`} onClick={() => setFilters(filters.filter((_, k) => k !== i))}><Icon name="x" size={12} /></button>
          </span>
        ))}
        {draft ? (
          <span className="draft">
            <select className="input" value={draft.column} aria-label="Column" onChange={e => setDraft({ ...draft, column: e.target.value })}>
              {page?.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select className="input" value={draft.op} aria-label="Operator" onChange={e => setDraft({ ...draft, op: e.target.value as FilterOp })}>
              {OPS.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {needsValue && (
              <input className="input mono" value={draft.value} autoFocus aria-label="Value" spellCheck={false}
                placeholder={draft.op === 'in' ? 'a, b, c' : draft.op === 'contains' || draft.op === 'startsWith' ? 'text' : 'value'}
                onChange={e => setDraft({ ...draft, value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Escape') setDraft(null); }} />
            )}
            <button type="button" className="btn primary" onClick={addFilter}>Add</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn ghost" disabled={!page} onClick={startDraft}><Icon name="plus" size={14} />Filter</button>
        )}
        <button type="button" className={`btn ghost${showWhere ? ' on' : ''}`} aria-pressed={showWhere} onClick={() => setShowWhere(s => !s)}>Where…</button>
        {showWhere && (
          <>
            <input className="input mono grow2" value={whereDraft} aria-label="SQL condition" spellCheck={false}
              placeholder="status = 'paid' AND total_cents > 1000" onChange={e => setWhereDraft(e.target.value)} />
            <button type="submit" className="btn primary" disabled={whereDraft.trim() === where.trim()}>Apply</button>
          </>
        )}
        {(filtered || sort || finding) && <button type="button" className="btn ghost" onClick={clearAll}>Clear</button>}
        <span className="grow" />
        <label className="find" title="Narrows the rows already loaded, without a query">
          <Icon name="search" size={12} />
          <input value={find} placeholder="Find in results" aria-label="Find in results" spellCheck={false} onChange={e => setFind(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setFind(''); }} />
          {finding && page && <span className="faint">{hits.length} of {page.rows.length}</span>}
        </label>
      </form>

      <div className={`results${loading && page ? ' stale' : ''}`} aria-busy={loading || undefined}>
        {error ? (
          <div className="msg error">
            <b>{error.message}</b>
            {error.detail && <pre>{error.detail}</pre>}
            {error.position !== undefined && error.position !== null && where.trim() && (
              <pre className="mono">{where.trim()}{'\n'}{' '.repeat(Math.max(0, error.position - 1))}^</pre>
            )}
          </div>
        ) : !page ? <Placeholder loading title={`Loading ${table}…`} />
          : page.rows.length ? (
            <Grid columns={page.columns} rows={page.rows} offset={offset} sort={sort} onSort={c => setSort(nextSort(sort, c))}
              visible={finding ? hits : undefined} highlight={finding ? find : undefined} />
          )
          : filtered ? <Placeholder title="No rows match these filters">Remove a filter or change the condition.</Placeholder>
          : offset > 0 ? <Placeholder title="No more rows">This is the end of {table}. Go back with Previous.</Placeholder>
          : <Placeholder title={`${table} is empty`}>The table has no rows yet.</Placeholder>}
      </div>
      {page && !error && (
        <div className="gridfoot">
          <span>{rowCountText(offset, page.rows.length, count) || (filtered ? 'No rows match' : 'No rows')}</span>
          {finding && <span>{hits.length} of {page.rows.length} loaded rows match “{find.trim()}”</span>}
          <span className="faint">{page.elapsedMs} ms</span>
          {sort && <span className="faint">sorted by {sort.column} {sort.descending ? 'descending' : 'ascending'}</span>}
        </div>
      )}
    </div>
  );
}
