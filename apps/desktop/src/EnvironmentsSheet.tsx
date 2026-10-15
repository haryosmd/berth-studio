// The workspace's environments: add, rename, colour, mark as production, reorder, remove.
// Removing an environment that still has profiles asks first and lists what will be deleted.
import { useState } from 'react';
import { api } from './api';
import { Icon } from './Icons';
import { nextEnvId, validEnvId } from './logic';
import { CONFIRM_ENV_DELETE, type DbError, type Environment } from './types';

interface Props {
  environments: Environment[];
  onClose: () => void;
  onSaved: (envs: Environment[]) => void;
}

export function EnvironmentsSheet({ environments, onClose, onSaved }: Props) {
  // New rows can still change their id; existing ids are fixed because profiles and keychain items use them.
  const [rows, setRows] = useState<(Environment & { isNew?: boolean })[]>(() => structuredClone(environments));
  const [error, setError] = useState<DbError | null>(null);
  const [confirm, setConfirm] = useState<DbError | null>(null);
  const [busy, setBusy] = useState(false);

  // Any edit invalidates a pending delete confirmation: the list it described has changed.
  const edit = (next: typeof rows) => { setRows(next); setConfirm(null); };
  const set = (i: number, patch: Partial<Environment>) => edit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    edit(next);
  };
  const add = () => {
    const id = nextEnvId(rows);
    edit([...rows, { id, label: id, color: '#4F6D7A', production: false, isNew: true }]);
  };
  const clean = (envs: (Environment & { isNew?: boolean })[]): Environment[] =>
    envs.map(({ isNew: _new, ...e }) => ({
      ...e,
      label: e.label.trim(),
      longName: e.longName?.trim() || undefined,
      shortName: e.shortName?.trim() || undefined,
    }));

  const save = async (confirmDelete: boolean) => {
    setBusy(true); setError(null);
    try {
      onSaved(await api.saveEnvironments(clean(rows), confirmDelete));
    } catch (e) {
      const err = e as DbError;
      if (err.code === CONFIRM_ENV_DELETE) setConfirm(err);
      else setError(err);
    } finally { setBusy(false); }
  };

  const badIds = rows.filter(r => !validEnvId(r.id)).map(r => r.id);

  return (
    <div className="scrim" role="presentation" onKeyDown={e => e.key === 'Escape' && onClose()}>
      <form className="sheet wide" role="dialog" aria-label="Environments" onSubmit={e => { e.preventDefault(); save(false); }}>
        <header>
          <Icon name="gear" />
          <h2>Environments</h2>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="content">
          <p className="muted" style={{ margin: 0 }}>
            Every connection can have one profile per environment. Production environments open read-only, and writes there ask for the connection name.
          </p>
          <table className="plain envs">
            <thead>
              <tr><th /><th>Id</th><th>Label</th><th title="Other ways this environment is written in host and database names">Also written as</th><th>Production</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input type="color" value={r.color} onChange={e => set(i, { color: e.target.value })} aria-label={`Colour of ${r.id}`} /></td>
                  <td>
                    <input className="input mono" value={r.id} disabled={!r.isNew}
                      onChange={e => set(i, { id: e.target.value.toLowerCase() })} aria-label="Environment id" style={{ width: 120 }} />
                  </td>
                  <td><input className="input" value={r.label} onChange={e => set(i, { label: e.target.value })} aria-label="Label" style={{ width: 140 }} /></td>
                  <td className="aliases">
                    <input className="input mono" value={r.longName ?? ''} placeholder="long, e.g. development" onChange={e => set(i, { longName: e.target.value })} aria-label="Long name" />
                    <input className="input mono" value={r.shortName ?? ''} placeholder="short, e.g. stg" onChange={e => set(i, { shortName: e.target.value })} aria-label="Short name" />
                  </td>
                  <td><input type="checkbox" checked={r.production} onChange={e => set(i, { production: e.target.checked })} aria-label={`${r.id} is production`} /></td>
                  <td className="row-actions">
                    <button type="button" className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                    <button type="button" className="iconbtn" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    <button type="button" className="iconbtn" disabled={rows.length === 1} onClick={() => edit(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.id}`}><Icon name="x" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div><button type="button" className="btn" onClick={add}><Icon name="plus" />Add environment</button></div>
          {badIds.length > 0 && <div className="errors">Ids use lowercase letters, digits, hyphens or underscores and start with a letter: {badIds.join(', ') || '(empty)'}</div>}
          {error && <div className="errors" role="alert"><b>{error.message}</b>{error.detail && <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{error.detail}</pre>}</div>}
          {confirm && (
            <div className="errors" role="alert">
              <b>{confirm.message}</b> Their profiles and saved passwords will be deleted:
              <pre style={{ margin: '4px 0 8px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)' }}>{confirm.detail}</pre>
              <button type="button" className="btn danger solid" disabled={busy} onClick={() => save(true)}>Delete these profiles and save</button>
            </div>
          )}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || badIds.length > 0}>Save</button>
        </footer>
      </form>
    </div>
  );
}
