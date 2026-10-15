import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { api } from './api';
import { Grid } from './Grid';
import { Icon } from './Icons';
import { lineCol, newRunId } from './logic';
import { ConfirmDialog } from './ConfirmDialog';
import { CONFIRM_CODE, NO_WRITE, type DbError, type EnvId, type RouteMode, type RunResult } from './types';
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

const START = `-- Reads go to a read replica when the profile has one; writes stay on the primary.
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
}

export function QueryView({ conn, env, envLabel, hasRead, hasWrite, envControl, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const runRef = useRef<() => void>(() => {});
  const [mode, setMode] = useState<RouteMode>('auto');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<{ e: DbError; sql: string } | null>(null);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      doc: START,
      parent: host.current,
      extensions: [
        basicSetup,
        sql({ dialect: PostgreSQL }),
        syntaxHighlighting(highlight),
        chrome,
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (runRef.current(), true) }])),
      ],
    });
    view.current = v;
    return () => v.destroy();
  }, []);

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
    } catch (e) {
      const err = e as DbError;
      if (err.code === CONFIRM_CODE) setConfirm(text);
      else setError({ e: err, sql: text });
    } finally {
      setRunning(null);
    }
  }, [conn, env, mode, onStatus]);

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
          ? <button className="btn danger" onClick={() => api.cancelQuery(running)}><Icon name="stop" />Cancel</button>
          : <button className="btn primary" onClick={run}><Icon name="play" />Run<kbd>⌘↵</kbd></button>}
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
      <div className="results">
        <div className="rtabs" role="tablist">
          {result?.results.map((s, i) => (
            <button key={i} role="tab" aria-selected={i === active} onClick={() => setActive(i)}>
              {s.columns.length ? `Result ${i + 1}` : `Statement ${i + 1}`}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {result && <span className={`chip ${result.role}`} title={result.reason}>ran on {result.role} · {result.host} · {result.elapsedMs} ms</span>}
        </div>
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
          set.columns.length
            ? <>{set.truncated && <div className="note">Showing the first {set.rows.length.toLocaleString()} rows.</div>}<Grid columns={set.columns} rows={set.rows} /></>
            : <div className="msg">{set.affected ?? 0} row{set.affected === 1 ? '' : 's'} affected.</div>
        ) : <div className="msg faint">{running ? 'Running…' : 'Run a query to see results here.'}</div>}
      </div>
      {confirm && (
        <ConfirmDialog connection={conn} environment={envLabel} what="This statement changes data" onCancel={() => setConfirm(null)}
          onConfirm={typed => { const text = confirm; setConfirm(null); execute(text, typed); }} />
      )}
    </div>
  );
}
