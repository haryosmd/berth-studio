import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Compartment, Prec } from '@codemirror/state';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { api } from './api';
import { ExportMenu } from './ExportMenu';
import { Grid } from './Grid';
import { Placeholder, Spinner } from './Status';
import { Icon } from './Icons';
import { lineCol, newRunId, toSqlNamespace } from './logic';
import { ConfirmDialog } from './ConfirmDialog';
import { CONFIRM_CODE, NO_WRITE, type DbError, type EnvId, type RouteMode, type RunResult, type SchemaColumn } from './types';
import type { Status } from './App';

// Syntax colours come from the design tokens, so they follow the light and dark themes.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--t-kw)', fontWeight: '500' },
  { tag: [t.string, t.special(t.string)], color: 'var(--t-str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--t-num)' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--fg-3)', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--t-json)' },
  { tag: [t.special(t.name), t.variableName], color: 'var(--fg)' },
  { tag: t.punctuation, color: 'var(--fg-2)' },
]);
const chrome = EditorView.theme({
  '&': { backgroundColor: 'var(--win)', color: 'var(--fg)' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft)' },
  '.cm-tooltip': { backgroundColor: 'var(--raise)', border: '1px solid var(--line)', color: 'var(--fg)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--sel)', outline: '1px solid var(--accent-line)' },
});

/** What a new query tab starts with. */
export const START = `-- Reads go to a read replica when the profile has one; writes stay on the primary.
SELECT id, email, plan, last_login
  FROM users
 ORDER BY last_login DESC NULLS LAST
 LIMIT 100;
`;

interface Props {
  conn: string;
  env: EnvId;
  envLabel: string;
  hasRead: boolean;
  hasWrite: boolean;
  envControl: ReactNode;
  onStatus: (s: Status) => void;
  /** The tab's text, kept by App so switching tabs does not lose it. */
  initialSql: string;
  onChange: (sql: string) => void;
  /** After every run that reached the server, so the history (and, after DDL, the schema cache) can refresh. */
  onRan: (sql: string) => void;
  /** The tab's name, which exports are named after. */
  title: string;
  /** Every readable column of the connection, for completion; null until the cache has loaded. */
  schema: SchemaColumn[] | null;
  onSave: () => void;
  onHistory: () => void;
  /** Text to put at the cursor, such as a statement picked from the history; `seq` makes each request new. */
  inject: { sql: string; seq: number } | null;
}

export function QueryView({ conn, env, envLabel, hasRead, hasWrite, envControl, onStatus, initialSql, onChange, onRan, onSave, onHistory, inject, schema, title }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const runRef = useRef<() => void>(() => {});
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const lang = useRef(new Compartment());
  const language = (cols: SchemaColumn[] | null) =>
    sql({ dialect: PostgreSQL, ...(cols ? { schema: toSqlNamespace(cols), defaultSchema: 'public' } : {}) });
  const [mode, setMode] = useState<RouteMode>('auto');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<{ e: DbError; sql: string } | null>(null);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      doc: initialSql,
      parent: host.current,
      extensions: [
        basicSetup,
        lang.current.of(language(schema)),
        syntaxHighlighting(highlight),
        chrome,
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (runRef.current(), true) }])),
        EditorView.updateListener.of(u => { if (u.docChanged) changeRef.current(u.state.doc.toString()); }),
      ],
    });
    view.current = v;
    return () => v.destroy();
    // The editor is created once per tab; later text comes from the editor itself.
  }, []);
  // Completion learns the schema once the cache arrives, and again whenever it is reloaded.
  useEffect(() => { view.current?.dispatch({ effects: lang.current.reconfigure(language(schema)) }); }, [schema]);
  useEffect(() => {
    const v = view.current;
    if (!v || !inject) return;
    const { from, to } = v.state.selection.main;
    // At the end of a line that already holds text, the statement starts on a line of its own.
    const line = v.state.doc.lineAt(from);
    const insert = (line.text.trim() && from === line.to ? '\n' : '') + inject.sql;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    v.focus();
  }, [inject]);

  const execute = useCallback(async (text: string, typed: string | null) => {
    const runId = newRunId();
    setRunning(runId);
    setError(null);
    try {
      const r = await api.runQuery(conn, env, text, mode, typed, runId);
      setResult(r);
      setActive(Math.max(0, r.results.findIndex(s => s.columns.length > 0)));
      const rows = r.results.reduce((n, s) => n + s.rows.length, 0);
      onStatus({ role: r.role, host: r.host, detail: `${rows} rows · ${r.elapsedMs} ms`, readOnly: r.readOnly });
      onRan(text);
    } catch (e) {
      const err = e as DbError;
      if (err.code === CONFIRM_CODE) setConfirm(text);
      else { setError({ e: err, sql: text }); onRan(text); }
    } finally {
      setRunning(null);
    }
  }, [conn, env, mode, onStatus, onRan]);

  const run = useCallback(() => {
    const v = view.current;
    if (!v || running) return;
    const sel = v.state.selection.main;
    const text = sel.empty ? v.state.doc.toString() : v.state.sliceDoc(sel.from, sel.to);
    execute(text, null);
  }, [execute, running]);
  runRef.current = run;

  const set = result?.results[active];
  const at = error?.e.position ? lineCol(error.sql, error.e.position) : null;

  return (
    <div className="pane">
      <div className="toolbar">
        {running
          ? <button className="btn danger" onClick={() => api.cancelQuery(running)}><Spinner />Cancel</button>
          : <button className="btn primary" onClick={run}><Icon name="play" />Run<kbd>⌘↵</kbd></button>}
        <button className="btn" onClick={onSave} title="Save this query in the workspace"><Icon name="bookmark" />Save<kbd>⌘S</kbd></button>
        <button className="iconbtn" onClick={onHistory} aria-label={`Query history of ${conn}`} title="Query history"><Icon name="clock" /></button>
        <span className="grow" />
        {envControl}
        <label className="target" title="Where this query runs">
          <span className="faint">{conn} ·</span>
          {hasWrite ? (
            <select value={mode} onChange={e => setMode(e.target.value as RouteMode)} aria-label="Query target">
              <option value="auto">{hasRead ? 'auto → read for reads' : 'auto (no read replica)'}</option>
              <option value="write">write only</option>
              {hasRead && <option value="read">read only</option>}
            </select>
          ) : <span className="chip read" title="This profile has read endpoints only">read only profile</span>}
        </label>
      </div>
      <div className="editor" ref={host} />
      <div className={`results${running && set ? ' stale' : ''}`} aria-busy={!!running}>
        <div className="rtabs" role="tablist">
          {result?.results.map((s, i) => (
            <button key={i} role="tab" aria-selected={i === active} onClick={() => setActive(i)}>
              {s.columns.length ? `Result ${i + 1}` : `Statement ${i + 1}`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {result && <span className={`chip ${result.role}`} title={result.reason}>ran on {result.role} · {result.host} · {result.elapsedMs} ms</span>}
          {set && set.columns.length > 0 && <ExportMenu name={title} columns={set.columns.map(c => c.name)} rows={set.rows} partial={set.truncated} />}
        </div>
        {running && set && <div className="note running"><Spinner />Running… the results below are from the previous run.</div>}
        {result?.warn && <div className="note">{result.warn}</div>}
        {error ? (
          <div className="msg error">
            <b>{error.e.message}</b>{at && <span className="muted"> · line {at.line}, column {at.col}</span>}
            {error.e.detail && <pre>{error.e.detail}</pre>}
            {error.e.hint && <pre>Hint: {error.e.hint}</pre>}
            {error.e.code === '25006' && <pre>This session is read-only. Writes run on the primary, and production writes ask for the connection name.</pre>}
            {error.e.code === NO_WRITE && <pre>Add a primary to this profile in Edit profiles to allow writes.</pre>}
          </div>
        ) : set ? (
          !set.columns.length
            ? <Placeholder title={`${set.affected ?? 0} row${set.affected === 1 ? '' : 's'} affected`}>The statement ran and returned no result set.</Placeholder>
            : !set.rows.length ? <Placeholder title="No rows">The query ran and returned no rows.</Placeholder>
            : <>{set.truncated && <div className="note">Showing the first {set.rows.length.toLocaleString()} rows.</div>}<Grid columns={set.columns} rows={set.rows} /></>
        ) : running ? <Placeholder loading title="Running…">Cancel stops it on the server.</Placeholder>
        : <Placeholder title="No results yet">Run a query with ⌘↵ to see its results here.</Placeholder>}
      </div>
      {confirm && (
        <ConfirmDialog connection={conn} environment={envLabel} what="This statement changes data" onCancel={() => setConfirm(null)}
          onConfirm={typed => { const text = confirm; setConfirm(null); execute(text, typed); }} />
      )}
    </div>
  );
}
