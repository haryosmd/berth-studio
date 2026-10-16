// New or edit connection: one tab per workspace environment. A PostgreSQL profile has an optional
// primary and any number of read replicas; a MongoDB profile has one connection string. Passwords
// typed here go to Rust once and are stored in the macOS Keychain.
import { useState } from 'react';
import { api } from './api';
import { Icon } from './Icons';
import { Spinner } from './Status';
import { blankEndpoint, blankProfile, copyProfile, findEnv, hasWrite, roleIndex } from './logic';
import type { Connection, DbError, Endpoint, EndpointCheck, Engine, EnvId, Environment, PasswordInput, Profile } from './types';

interface Props {
  existing: Connection | null;
  startEnv: EnvId;
  environments: Environment[];
  onClose: () => void;
  onSaved: (c: Connection) => void;
  onDeleted: (id: string) => void;
}

export function ConnectionSheet({ existing, startEnv, environments, onClose, onSaved, onDeleted }: Props) {
  const startEnvironment = findEnv(environments, startEnv) ?? environments[0];
  const [engine, setEngine] = useState<Engine>(existing?.engine ?? 'postgres');
  const [id, setId] = useState(existing?.id ?? '');
  const [profiles, setProfiles] = useState<Connection['profiles']>(() =>
    structuredClone(existing?.profiles ?? { [startEnvironment.id]: blankProfile(startEnvironment) }));
  const [env, setEnv] = useState<EnvId>(startEnvironment.id);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [error, setError] = useState<DbError | null>(null);
  const [checks, setChecks] = useState<EndpointCheck[] | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // What the sheet opened with, so closing can tell edits from a look.
  const [opened] = useState(() => JSON.stringify(profiles));
  const dirty = Object.values(pw).some(Boolean) || JSON.stringify(profiles) !== opened || (!existing && id.trim() !== '');
  const close = () => (dirty ? setConfirmClose(true) : onClose());

  const environment = findEnv(environments, env) ?? startEnvironment;
  const p = profiles[env];
  const key = (e: EnvId, prof: Profile, i: number) => `${e}/${prof.endpoints[i].role}/${roleIndex(prof, i)}`;
  const passwords = (): PasswordInput[] =>
    Object.entries(pw).filter(([, v]) => v).map(([k, password]) => {
      const [e, role, index] = k.split('/');
      return { env: e, role: role as 'write' | 'read', index: Number(index), password };
    });

  const setProfile = (next: Profile | undefined) => { setProfiles({ ...profiles, [env]: next }); setChecks(null); };
  const setEp = (i: number, patch: Partial<Endpoint>) => p && setProfile({ ...p, endpoints: p.endpoints.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const source = environments.find(e => e.id !== env && profiles[e.id]);

  const switchEngine = (next: Engine) => {
    setEngine(next);
    setProfiles({ [env]: blankProfile(environment, next) });
    setPw({});
    setChecks(null);
  };

  const save = async () => {
    setBusy('save'); setError(null);
    try {
      const kept = Object.fromEntries(Object.entries(profiles).filter(([, v]) => v));
      onSaved(await api.saveConnection({ id: id.trim(), engine, profiles: kept }, passwords()));
    } catch (e) { setError(e as DbError); } finally { setBusy(null); }
  };
  const test = async () => {
    if (!p) return;
    setBusy('test'); setError(null); setChecks(null);
    try { setChecks(await api.testProfile(id.trim() || 'new-connection', engine, env, p, passwords().filter(x => x.env === env))); }
    catch (e) { setError(e as DbError); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!existing) return;
    setBusy('delete');
    try { await api.deleteConnection(existing.id); onDeleted(existing.id); } catch (e) { setError(e as DbError); setBusy(null); }
  };

  const passwordField = (i: number, e: Endpoint) => {
    const k = key(env, p!, i);
    return (
      <label className="field"><span>Password</span>
        <input className="input" type="password" autoComplete="off" value={pw[k] ?? ''}
          placeholder={e.secret ? '••••••••••••' : e.needsSecret ? 'Needs a password' : 'None yet'} onChange={x => setPw({ ...pw, [k]: x.target.value })} />
        <span className="faint">
          {pw[k] ? 'Stored in the Keychain when you save.'
            : e.secret ? 'Saved in the Keychain and never shown again. Type to replace it.'
            : e.needsSecret ? 'Copied without its password. Type it here.'
            : 'Stored in the Keychain when you save.'}
        </span>
      </label>
    );
  };

  return (
    <div className="scrim" role="presentation" onKeyDown={e => e.key === 'Escape' && close()}>
      <form className="sheet" role="dialog" aria-label={existing ? `Edit ${existing.id}` : 'New connection'} onSubmit={e => { e.preventDefault(); save(); }}>
        <header>
          <Icon name={engine === 'mongodb' ? 'leaf' : 'db'} />
          <h2>{existing ? `Edit ${existing.id}` : 'New connection'}</h2>
          <button type="button" className="iconbtn" onClick={close} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="content">
          {!existing && (
            <div className="seg engines" role="group" aria-label="Database">
              <button type="button" aria-pressed={engine === 'postgres'} onClick={() => switchEngine('postgres')}><Icon name="db" />PostgreSQL</button>
              <button type="button" aria-pressed={engine === 'mongodb'} onClick={() => switchEngine('mongodb')}><Icon name="leaf" />MongoDB</button>
            </div>
          )}
          <label className="field">
            <span>Name, used in every environment</span>
            <input className="input mono" value={id} disabled={!!existing} autoFocus={!existing} placeholder={engine === 'mongodb' ? 'events-db' : 'acme-db'}
              onChange={e => setId(e.target.value.toLowerCase())} />
          </label>

          <div className="ptabs" role="tablist" aria-label="Environment profile">
            {environments.map(e => (
              <button key={e.id} type="button" role="tab" aria-selected={e.id === env} onClick={() => { setEnv(e.id); setChecks(null); }}>
                <i className="dot" style={profiles[e.id] ? { background: e.color } : undefined} data-off={!profiles[e.id] || undefined} />{e.label}
              </button>
            ))}
          </div>

          <label className="check">
            <input type="checkbox" checked={!!p} onChange={e => setProfile(e.target.checked ? blankProfile(environment, engine) : undefined)} />
            Has a {environment.label} profile
          </label>

          {!p ? (
            <div className="faint">
              {id || 'This connection'} does not exist in {environment.label}.{' '}
              {source && <button type="button" className="btn" onClick={() => setProfile(copyProfile(profiles[source.id]!, source, environment).profile)}>Copy from {source.label}</button>}
            </div>
          ) : engine === 'mongodb' ? (
            <div className="epcard">
              <div className="head">MongoDB</div>
              <label className="field"><span>Connection string, without the password</span>
                <input className="input mono" value={p.endpoints[0].uri ?? ''} placeholder="mongodb+srv://cluster0.example.net/" onChange={x => setEp(0, { uri: x.target.value })} />
              </label>
              <div className="row4">
                <label className="field"><span>User</span><input className="input mono" value={p.endpoints[0].user} onChange={x => setEp(0, { user: x.target.value })} /></label>
                <label className="field"><span>Auth database</span><input className="input mono" value={p.endpoints[0].authSource ?? ''} placeholder="admin" onChange={x => setEp(0, { authSource: x.target.value })} /></label>
                {passwordField(0, p.endpoints[0])}
              </div>
              <label className="field"><span>Reads go to</span>
                <select className="input" value={p.readPreference ?? 'primary'} onChange={x => setProfile({ ...p, readPreference: x.target.value as Profile['readPreference'] })}>
                  <option value="primary">primary</option>
                  <option value="secondaryPreferred">a secondary when available (secondaryPreferred)</option>
                </select>
              </label>
            </div>
          ) : (
            <>
              {!hasWrite(p) && (
                <div className="lock"><Icon name="lock" />Read-only profile: only read replicas, so writes are refused.
                  <button type="button" className="btn" onClick={() => setProfile({ ...p, endpoints: [blankEndpoint('write', p.endpoints[0]), ...p.endpoints] })}><Icon name="plus" />Add primary</button>
                </div>
              )}
              {p.endpoints.map((e, i) => (
                <div className="epcard" key={i}>
                  <div className="head">
                    <span className={`chip ${e.role}`}>{e.role}</span>
                    {e.role === 'write' ? 'Primary' : `Read replica ${roleIndex(p, i) + 1}`}
                    <span className="grow" />
                    {(e.role === 'read' || p.endpoints.some(x => x.role === 'read')) && (
                      <button type="button" className="btn ghost" onClick={() => setProfile({ ...p, endpoints: p.endpoints.filter((_, j) => j !== i) })}>Remove</button>
                    )}
                  </div>
                  <div className="row4">
                    <label className="field"><span>Host</span><input className="input mono" value={e.host} onChange={x => setEp(i, { host: x.target.value })} /></label>
                    <label className="field"><span>Port</span><input className="input mono" inputMode="numeric" value={e.port} onChange={x => setEp(i, { port: Number(x.target.value.replace(/\D/g, '')) || 0 })} /></label>
                    <label className="field"><span>Database</span><input className="input mono" value={e.database} onChange={x => setEp(i, { database: x.target.value })} /></label>
                  </div>
                  <div className="row4">
                    <label className="field"><span>User</span><input className="input mono" value={e.user} onChange={x => setEp(i, { user: x.target.value })} /></label>
                    <label className="field"><span>TLS</span>
                      <select className="input" value={e.tls} onChange={x => setEp(i, { tls: x.target.value as Endpoint['tls'] })}>
                        <option value="auto">auto</option><option value="require">require</option><option value="disable">off</option>
                      </select>
                    </label>
                    {passwordField(i, e)}
                  </div>
                  {e.tls !== 'disable' && (
                    <label className="field"><span>CA certificate, optional: a PEM file trusted besides the system store, such as the Amazon RDS bundle</span>
                      <input className="input mono" value={e.caCert ?? ''} placeholder="None: only the system trust store" spellCheck={false}
                        onChange={x => setEp(i, { caCert: x.target.value || undefined })} />
                    </label>
                  )}
                </div>
              ))}
              <div className="addrow">
                <button type="button" className="btn" onClick={() => setProfile({ ...p, endpoints: [...p.endpoints, blankEndpoint('read', p.endpoints.find(x => x.role === 'write') ?? p.endpoints[0])] })}>
                  <Icon name="plus" />Add read replica
                </button>
                <span className="faint">Optional. Reads can go to a replica, such as an RDS reader endpoint or a read-only user. Writes always go to the primary.</span>
              </div>
            </>
          )}

          {p && (
            <>
              <label className="check">
                <input type="checkbox" checked={p.readOnly || environment.production} disabled={environment.production} onChange={e => setProfile({ ...p, readOnly: e.target.checked })} />
                Open read-only{environment.production && <span className="faint"> · always on in production; writes ask for the connection name</span>}
              </label>
              <div className="lock"><Icon name="lock" />Passwords go to the macOS Keychain. The workspace file only keeps a reference.</div>
            </>
          )}

          {checks && (
            <div className="checks">
              {checks.map(c => (
                <div key={`${c.role}${c.index}`}><span className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '✕'}</span>
                  <b>{engine === 'mongodb' ? 'Server' : c.role === 'write' ? 'Primary' : `Read replica ${c.index + 1}`}</b>
                  <span className="mono faint">{c.host}</span><span className="muted">{c.message}</span></div>
              ))}
            </div>
          )}
          {error && <div className="errors" role="alert"><b>{error.message}</b>{error.detail && <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{error.detail}</pre>}</div>}
        </div>
        <footer>
          {existing && (confirmDelete
            ? <><span className="muted">Delete {existing.id} and its saved passwords?</span><button type="button" className="btn danger solid" disabled={!!busy} onClick={remove}>{busy === 'delete' && <Spinner />}Delete</button><button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Keep</button></>
            : <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete…</button>)}
          <span className="grow" />
          <button type="button" className="btn" disabled={!!busy || !p} onClick={test}>
            {busy === 'test' ? <><Spinner />Testing…</> : `Test ${environment.label}`}
          </button>
          {confirmClose ? (
            <><span className="muted">Discard unsaved changes{Object.values(pw).some(Boolean) ? ', including the typed password' : ''}?</span>
              <button type="button" className="btn danger solid" onClick={onClose}>Discard</button>
              <button type="button" className="btn" autoFocus onClick={() => setConfirmClose(false)}>Keep editing</button></>
          ) : (
            <><button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!!busy || !id.trim() || !Object.values(profiles).some(Boolean)}>
                {busy === 'save' ? <><Spinner />Saving…</> : 'Save'}
              </button></>
          )}
        </footer>
      </form>
    </div>
  );
}
