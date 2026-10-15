import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { Grid } from './Grid';
import { Placeholder, Spinner } from './Status';
import type { DbError, EnvId, Page } from './types';
import type { Status } from './App';

const PAGE = 200;

interface Props {
  conn: string;
  env: EnvId;
  schema: string;
  table: string;
  envControl: ReactNode;
  onStatus: (s: Status) => void;
}

export function TableView({ conn, env, schema, table, envControl, onStatus }: Props) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<DbError | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => setOffset(0), [conn, env, schema, table]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.browseTable(conn, env, schema, table, PAGE, offset)
      .then(p => {
        if (!live) return;
        setPage(p);
        setError(null);
        onStatus({ role: 'read', host: p.host, detail: `${p.rows.length} rows · ${p.elapsedMs} ms`, readOnly: true });
      })
      .catch((e: DbError) => live && (setError(e), setPage(null)))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [conn, env, schema, table, offset, nonce, onStatus]);

  return (
    <div className="pane">
      <div className="toolbar">
        <span className="crumb"><span className="faint">{conn} · {schema}.</span>{table}</span>
        <span className="grow" />
        {envControl}
        {loading && page && <Spinner label="Loading rows" />}
        <span className="faint">{page?.rows.length ? `Rows ${offset + 1}–${offset + page.rows.length}` : ''}</span>
        <button className="btn" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
        <button className="btn" disabled={!page || page.rows.length < PAGE || loading} onClick={() => setOffset(offset + PAGE)}>Next</button>
        <button className="btn" disabled={loading} onClick={() => setNonce(n => n + 1)}>Refresh</button>
      </div>
      {error ? <div className="msg error"><b>{error.message}</b>{error.detail && <pre>{error.detail}</pre>}</div>
        : !page ? <Placeholder loading title={`Loading ${table}…`} />
        : page.rows.length ? <Grid columns={page.columns} rows={page.rows} offset={offset} />
        : offset > 0 ? <Placeholder title="No more rows">This is the end of {table}. Go back with Previous.</Placeholder>
        : <Placeholder title={`${table} is empty`}>The table has no rows yet.</Placeholder>}
    </div>
  );
}
