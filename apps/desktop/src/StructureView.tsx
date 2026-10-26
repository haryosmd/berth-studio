// A table's Structure, Indexes and DDL views, read from the catalog by `table_structure`.
import { useState } from 'react';
import { Icon } from './Icons';
import { Placeholder } from './Status';
import { fkLabel, formatBytes } from './logic';
import type { DbError, ForeignKey, TableStructure } from './types';

export type StructureTab = 'structure' | 'indexes' | 'ddl';

interface Props {
  view: StructureTab;
  structure: TableStructure | DbError | null;
  foreignKeys: ForeignKey[];
}

const isError = (v: unknown): v is DbError => typeof v === 'object' && v !== null && 'message' in v;

export function StructureView({ view, structure: s, foreignKeys }: Props) {
  const [copied, setCopied] = useState(false);
  if (!s) return <Placeholder loading title="Reading the catalog…" />;
  if (isError(s)) return <div className="msg error"><b>{s.message}</b>{s.detail && <pre>{s.detail}</pre>}</div>;

  if (view === 'ddl') {
    const copy = () => navigator.clipboard.writeText(s.ddl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
    return (
      <div className="structure-pane">
        <div className="structure-actions">
          <span className="faint">Generated from the catalog of {s.schema}.{s.name}</span>
          <span className="grow" />
          <button className="btn" onClick={copy}><Icon name="copy" size={14} />{copied ? 'Copied' : 'Copy DDL'}</button>
        </div>
        <pre className="json-view ddl">{s.ddl}</pre>
      </div>
    );
  }

  if (view === 'indexes') {
    return (
      <div className="structure-pane scroll">
        {s.indexes.length ? (
          <table className="plain structure">
            <thead><tr><th>Index</th><th>Method</th><th>Columns</th><th>Kind</th><th className="num">Size</th></tr></thead>
            <tbody>
              {s.indexes.map(i => (
                <tr key={i.name} title={i.definition}>
                  <td className="mono">{i.name}</td>
                  <td className="faint">{i.method}</td>
                  <td className="mono">{i.columns}</td>
                  <td><span className={`pill${i.primary || i.unique ? ' accent' : ''}`}>{i.primary ? 'PRIMARY KEY' : i.unique ? 'UNIQUE' : 'INDEX'}</span></td>
                  <td className="num faint">{formatBytes(i.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Placeholder title="No indexes">{s.kind.includes('view') && s.kind !== 'materialized view' ? 'A view has no indexes of its own.' : 'This table has no indexes.'}</Placeholder>}
        {s.constraints.length > 0 && (
          <table className="plain structure">
            <thead><tr><th>Constraint</th><th>Kind</th><th>Definition</th></tr></thead>
            <tbody>
              {s.constraints.map(k => (
                <tr key={k.name}><td className="mono">{k.name}</td><td className="faint">{k.kind}</td><td className="mono">{k.definition}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // A column's own keys: the primary key, the foreign keys it is part of, and single-column unique indexes.
  const keysOf = (name: string, pk: boolean) => [
    ...(pk ? ['PK'] : []),
    ...foreignKeys.filter(f => f.columns.includes(name)).map(f => fkLabel({ schema: f.refSchema, table: f.refTable, column: f.refColumns[f.columns.indexOf(name)] })),
    ...s.indexes.filter(i => i.unique && !i.primary && i.columns === name).map(() => 'UNIQUE'),
  ];
  return (
    <div className="structure-pane scroll">
      <table className="plain structure">
        <thead><tr><th>Column</th><th>Type</th><th>Nullable</th><th>Default</th><th>Keys</th><th>Comment</th></tr></thead>
        <tbody>
          {s.columns.map(c => (
            <tr key={c.name}>
              <td className="mono">{c.primaryKey && <span className="pk"><Icon name="key" size={12} /></span>}{c.name}</td>
              <td className="mono type">{c.typeName}</td>
              <td>{c.nullable ? <span className="pill">NULL</span> : <span className="faint">NOT NULL</span>}</td>
              <td className="mono">
                {c.generated ? `GENERATED ALWAYS AS ${c.generated}` : c.identity ? `GENERATED ${c.identity} AS IDENTITY` : c.default ?? <span className="faint">—</span>}
              </td>
              <td>{keysOf(c.name, c.primaryKey).map(k => <span key={k} className={`pill${k === 'PK' ? ' accent' : ''}`}>{k}</span>)}</td>
              <td className="muted">{c.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.comment && <p className="structure-note muted">{s.comment}</p>}
    </div>
  );
}
