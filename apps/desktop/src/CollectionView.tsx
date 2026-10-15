// One MongoDB collection: documents (filter, sort, projection), aggregation, indexes, and guarded
// document edits. Writes in production environments ask for the connection name; the Rust side
// checks it again and refuses writes for read-only profiles.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { ConfirmDialog } from './ConfirmDialog';
import { Grid } from './Grid';
import { Icon } from './Icons';
import { Placeholder, Spinner } from './Status';
import { documentsToGrid, idText } from './logic';
import { CONFIRM_CODE, NO_WRITE, type DbError, type DocumentWrite, type Documents, type EnvId, type Json } from './types';
import type { Status } from './App';

type Mode = 'documents' | 'aggregate' | 'indexes';
type Doc = { [k: string]: Json };

interface Props {
  conn: string;
  env: EnvId;
  envLabel: string;
  db: string;
  collection: string;
  /** The profile opens read-only (always true in production). */
  readOnly: boolean;
  /** Writes are possible: the profile is writable, or it is production and asks for the name. */
  canWrite: boolean;
  envControl: ReactNode;
  onStatus: (s: Status) => void;
}

const LIMITS = [20, 50, 100, 500];
const START_PIPELINE = `[
  { "$match": {} },
  { "$limit": 20 }
]`;

export function CollectionView({ conn, env, envLabel, db, collection, readOnly, canWrite, envControl, onStatus }: Props) {
  const [mode, setMode] = useState<Mode>('documents');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('');
  const [projection, setProjection] = useState('');
  const [limit, setLimit] = useState(50);
  const [skip, setSkip] = useState(0);
  const [result, setResult] = useState<Documents | null>(null);
  const [error, setError] = useState<DbError | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ kind: 'insert' | 'replace'; text: string } | null>(null);
  const [pipeline, setPipeline] = useState(START_PIPELINE);
  const [indexes, setIndexes] = useState<{ name: string; keys: Record<string, unknown>; unique: boolean }[] | null>(null);
  const [pending, setPending] = useState<{ what: string; run: (confirm: string) => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = useCallback((docs: Documents) => {
    onStatus({ role: 'read', host: `${db}.${collection}`, detail: `${docs.documents.length} documents · ${docs.elapsedMs} ms`, readOnly: true });
  }, [db, collection, onStatus]);

  const find = useCallback(async (from = skip) => {
    setBusy(true); setError(null); setSelected(null); setEditor(null);
    try {
      const r = await api.findDocuments(conn, env, db, collection, { filter, sort, projection, skip: from, limit });
      setResult(r); setSkip(from); status(r);
    } catch (e) { setError(e as DbError); setResult(null); } finally { setBusy(false); }
  }, [conn, env, db, collection, filter, sort, projection, limit, skip, status]);

  // Load the first page whenever the collection or the environment changes.
  useEffect(() => { setSkip(0); setNotice(null); }, [conn, env, db, collection]);
  useEffect(() => {
    if (mode === 'documents') find(0);
    if (mode === 'indexes') {
      setIndexes(null);
      api.listIndexes(conn, env, db, collection).then(setIndexes).catch((e: DbError) => { setError(e); setIndexes([]); });
    }
  }, [conn, env, db, collection, mode]);

  const aggregate = async (confirm: string | null) => {
    setBusy(true); setError(null); setSelected(null);
    try {
      const r = await api.aggregate(conn, env, db, collection, pipeline, confirm);
      setResult(r); status(r);
    } catch (e) {
      const err = e as DbError;
      if (err.code === CONFIRM_CODE) setPending({ what: 'This pipeline writes its results with $out or $merge', run: c => aggregate(c) });
      else { setError(err); setResult(null); }
    } finally { setBusy(false); }
  };

  const write = async (change: DocumentWrite, what: string, confirm: string | null = null) => {
    setBusy(true); setWriting(true); setError(null);
    try {
      const r = await api.writeDocument(conn, env, db, collection, change, confirm);
      setNotice(r.message); setEditor(null);
      await find(skip);
    } catch (e) {
      const err = e as DbError;
      if (err.code === CONFIRM_CODE) setPending({ what, run: c => write(change, what, c) });
      else setError(err);
    } finally { setBusy(false); setWriting(false); }
  };

  const grid = useMemo(() => documentsToGrid(result?.documents ?? []), [result]);
  const doc: Doc | null = selected !== null && result ? result.documents[selected] : null;

  return (
    <div className="pane">
      <div className="toolbar">
        <span className="crumb"><span className="faint">{conn} · {db}.</span>{collection}</span>
        <div className="rtabs inline" role="tablist">
          {(['documents', 'aggregate', 'indexes'] as Mode[]).map(m => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setResult(null); setError(null); }}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="grow" />
        {envControl}
        {readOnly && <span className="chip read" title="This profile opens read-only">read-only</span>}
      </div>

      {mode === 'documents' && (
        <form className="filterbar" onSubmit={e => { e.preventDefault(); find(0); }}>
          <label className="field grow2"><span>Filter</span><input className="input mono" value={filter} placeholder='{ "type": "click" }' onChange={e => setFilter(e.target.value)} /></label>
          <label className="field"><span>Sort</span><input className="input mono" value={sort} placeholder='{ "at": -1 }' onChange={e => setSort(e.target.value)} /></label>
          <label className="field"><span>Projection</span><input className="input mono" value={projection} placeholder='{ "meta": 0 }' onChange={e => setProjection(e.target.value)} /></label>
          <label className="field"><span>Limit</span>
            <select className="input" value={limit} onChange={e => setLimit(Number(e.target.value))}>{LIMITS.map(n => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <button className="btn primary" type="submit" disabled={busy}>{busy && !writing ? <Spinner /> : <Icon name="play" />}Find</button>
          {canWrite && <button className="btn" type="button" onClick={() => setEditor({ kind: 'insert', text: '{\n  \n}' })}><Icon name="plus" />Insert</button>}
        </form>
      )}

      {mode === 'aggregate' && (
        <div className="pipeline">
          <textarea className="input mono" spellCheck={false} value={pipeline} onChange={e => setPipeline(e.target.value)} aria-label="Aggregation pipeline" />
          <div className="pipeline-actions">
            <button className="btn primary" disabled={busy} onClick={() => aggregate(null)}>{busy ? <Spinner /> : <Icon name="play" />}Run pipeline</button>
            <span className="faint">A JSON array of stages. Pipelines with $out or $merge write, so they follow the same rules as edits.</span>
          </div>
        </div>
      )}

      {notice && <div className="note ok-note">{notice}</div>}
      {error && (
        <div className="msg error">
          <b>{error.message}</b>
          {error.code && error.code !== NO_WRITE && <span className="muted"> · {error.code}</span>}
          {error.code === NO_WRITE && <pre>This profile opens read-only. Writes are only possible in environments where it is not.</pre>}
        </div>
      )}

      {mode === 'indexes' ? (
        indexes === null ? <Placeholder loading title="Loading indexes…" />
        : !indexes.length ? <Placeholder title="No indexes">{error ? 'The indexes could not be read.' : 'Views have no indexes of their own.'}</Placeholder>
        : <div className="msg">
          <table className="plain">
            <thead><tr><th>Name</th><th>Keys</th><th>Unique</th></tr></thead>
            <tbody>{(indexes ?? []).map(i => <tr key={i.name}><td className="mono">{i.name}</td><td className="mono">{JSON.stringify(i.keys)}</td><td>{i.unique ? 'yes' : ''}</td></tr>)}</tbody>
          </table>
        </div>
      ) : !result ? (
        error ? null
        : busy ? <Placeholder loading title={mode === 'aggregate' ? 'Running the pipeline…' : `Loading ${collection}…`} />
        : mode === 'aggregate' ? <Placeholder title="No results yet">Write a pipeline above and run it.</Placeholder>
        : null
      ) : !result.documents.length ? (
        mode === 'aggregate' ? <Placeholder title="No documents">The pipeline ran and returned nothing.</Placeholder>
        : skip > 0 ? <Placeholder title="No more documents">Go back with Previous.</Placeholder>
        : filter.trim() ? <Placeholder title="No documents match this filter">Change the filter, or clear it to see every document.</Placeholder>
        : <Placeholder title={`${collection} is empty`}>{canWrite ? 'Insert a document to start.' : 'The collection has no documents yet.'}</Placeholder>
      ) : (
        <div className={`split${busy && !writing ? ' stale' : ''}`} aria-busy={busy}>
          <div className="split-main">
            <div className="rtabs">
              <span className="faint">{result.documents.length} documents{result.truncated ? ', more available' : ''} · {result.elapsedMs} ms</span>
              <span style={{ flex: 1 }} />
              {mode === 'documents' && <>
                <button disabled={skip === 0 || busy} onClick={() => find(Math.max(0, skip - limit))}>Previous</button>
                <button disabled={!result.truncated || busy} onClick={() => find(skip + limit)}>Next</button>
              </>}
            </div>
            <Grid columns={grid.columns} rows={grid.rows} offset={mode === 'documents' ? skip : 0} selected={selected} onSelect={i => { setSelected(i); setEditor(null); }} />
          </div>
          {(doc || editor) && (
            <aside className="split-side">
              {editor ? (
                <>
                  <div className="side-title">{editor.kind === 'insert' ? 'New document' : 'Edit document'}</div>
                  <textarea className="input mono json" spellCheck={false} value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })} aria-label="Document" />
                  <div className="side-actions">
                    <button className="btn" onClick={() => setEditor(null)}>Cancel</button>
                    <button className="btn primary" disabled={busy} onClick={() => editor.kind === 'insert'
                      ? write({ action: 'insert', document: editor.text }, 'This inserts a document')
                      : doc && write({ action: 'replace', id: idText(doc), document: editor.text }, 'This replaces a document')}>{writing && <Spinner />}Save</button>
                  </div>
                </>
              ) : doc && (
                <>
                  <div className="side-title">Document</div>
                  <pre className="json-view">{JSON.stringify(doc, null, 2)}</pre>
                  {canWrite && mode === 'documents' && (
                    <div className="side-actions">
                      <button className="btn danger" disabled={busy} onClick={() => write({ action: 'delete', id: idText(doc) }, 'This deletes a document')}>{writing && <Spinner />}Delete</button>
                      <button className="btn" onClick={() => setEditor({ kind: 'replace', text: JSON.stringify(doc, null, 2) })}>Edit</button>
                    </div>
                  )}
                </>
              )}
            </aside>
          )}
        </div>
      )}

      {pending && (
        <ConfirmDialog connection={conn} environment={envLabel} what={pending.what} onCancel={() => setPending(null)}
          onConfirm={typed => { const p = pending; setPending(null); p.run(typed); }} />
      )}
    </div>
  );
}
