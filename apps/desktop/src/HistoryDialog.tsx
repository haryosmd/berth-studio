// The query history, like DataGrip's: every statement that reached a server, newest first, grouped
// by day, searchable and narrowed to one connection. The Rust side keeps it (src-tauri/src/history.rs).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api } from './api';
import { Icon } from './Icons';
import { Placeholder } from './Status';
import { clockTime, historyDay, sqlSummary } from './logic';
import type { DbError, HistoryEntry } from './types';

interface Props {
  connections: string[];
  /** The connection to start narrowed to; null shows every one. */
  conn: string | null;
  onClose: () => void;
  onOpen: (e: HistoryEntry) => void;
  /** Present when opened from a query tab: puts the statement at that editor's cursor. */
  onInsert?: (e: HistoryEntry) => void;
  onClear: (conn: string | null) => void;
}

export function HistoryDialog({ connections, conn: startConn, onClose, onOpen, onInsert, onClear }: Props) {
  const [conn, setConn] = useState(startConn);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.listHistory(conn, query.trim() || null, 500)
        .then(e => { setEntries(e); setSel(0); setError(null); })
        .catch((e: DbError) => setError(e.message));
    }, 150);
    return () => clearTimeout(t);
  }, [conn, query]);

  const groups = useMemo(() => {
    const out: { day: string; items: { e: HistoryEntry; i: number }[] }[] = [];
    (entries ?? []).forEach((e, i) => {
      const day = historyDay(e.at);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push({ e, i });
    });
    return out;
  }, [entries]);

  const current = entries?.[sel];
  const primary = (e: HistoryEntry) => (onInsert ? onInsert(e) : onOpen(e));
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown' && entries?.length) { e.preventDefault(); setSel(i => Math.min(entries.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && current && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); primary(current); }
  };

  return (
    <div className="scrim" role="presentation" onKeyDown={onKey}>
      <div className="sheet wide history" role="dialog" aria-label="Query history">
        <header>
          <Icon name="clock" />
          <h2>Query history</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="history-tools">
          <label className="find grow-find">
            <Icon name="search" size={12} />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search SQL, connection or host" spellCheck={false} aria-label="Search the history" />
          </label>
          <label className="target">
            <select value={conn ?? ''} onChange={e => setConn(e.target.value || null)} aria-label="Connection">
              <option value="">All connections</option>
              {connections.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="history-body">
          <div className="history-list" ref={list} role="listbox" aria-label="Runs">
            {error ? <div className="msg error">{error}</div>
              : !entries ? <Placeholder loading title="Loading history…" />
              : !entries.length ? <Placeholder title={query ? 'No match' : 'No history yet'}>{query ? 'Nothing in the history matches.' : 'Every statement you run is kept here, on this Mac only.'}</Placeholder>
              : groups.map(g => (
                <div key={g.day}>
                  <div className="history-day">{g.day}</div>
                  {g.items.map(({ e, i }) => (
                    <button key={`${e.at}-${i}`} role="option" aria-selected={i === sel} className="history-row" onClick={() => setSel(i)} onDoubleClick={() => primary(e)}>
                      <i className={`hdot${e.error ? ' bad' : ''}`} />
                      <span className="sql mono">{sqlSummary(e.sql)}</span>
                      <span className="faint">{clockTime(e.at)}</span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
          <div className="history-preview">
            {current ? (
              <>
                <div className="history-meta">
                  <span className={`chip ${current.role}`}>{current.role}</span>
                  <span>{current.conn} · {current.env} · <span className="mono">{current.host}</span></span>
                  <span className="faint">{current.error ? 'failed' : `${current.rows.toLocaleString('en-US')} rows`} · {current.elapsedMs} ms</span>
                </div>
                {current.error && <div className="msg error">{current.error}</div>}
                <pre className="json-view">{current.sql}</pre>
              </>
            ) : <Placeholder title="Pick a run">Its SQL shows here.</Placeholder>}
          </div>
        </div>
        <footer>
          <button className="btn danger" onClick={() => onClear(conn)} disabled={!entries?.length}>
            <Icon name="trash" />{conn ? `Clear ${conn}` : 'Clear all'}…
          </button>
          <span className="grow" />
          <span className="faint">↑ ↓ move · ↵ {onInsert ? 'insert' : 'open'}</span>
          {onInsert && <button className="btn" disabled={!current} onClick={() => current && onOpen(current)}>Open in new tab</button>}
          <button className="btn primary" disabled={!current} onClick={() => current && primary(current)}>{onInsert ? 'Insert into editor' : 'Open in new tab'}</button>
        </footer>
      </div>
    </div>
  );
}
