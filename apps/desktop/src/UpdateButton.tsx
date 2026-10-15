// The update icon in the title bar. It stays hidden until a check finds a newer release, then
// opens a small panel: what is new, download and install with progress, and restart.
// The Rust side verifies the release signature before anything is installed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './Icons';
import { formatBytes } from './logic';
import { Spinner } from './Status';
import type { DbError, UpdateInfo, UpdateProgress } from './types';

/** First check shortly after launch, then every six hours while the app is open. */
const FIRST_CHECK_MS = 5_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type State =
  | { step: 'available' }
  | { step: 'downloading'; downloaded: number; total: number | null }
  | { step: 'installed' }
  | { step: 'restarting' }
  | { step: 'failed'; message: string };

export function UpdateButton() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<State>({ step: 'available' });
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const check = useCallback(() => {
    // Once an update is downloading or installed, a new check would only replace what the user sees.
    api.checkUpdate()
      .then(found => setUpdate(current => (current && found && current.version === found.version ? current : found)))
      // Offline or GitHub unreachable: say nothing and try again at the next check.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (state.step !== 'available' && state.step !== 'failed') return;
    const first = setTimeout(check, FIRST_CHECK_MS);
    const every = setInterval(check, CHECK_EVERY_MS);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [check, state.step]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!update) return null;

  const install = async () => {
    setState({ step: 'downloading', downloaded: 0, total: null });
    try {
      await api.installUpdate((p: UpdateProgress) => {
        if (p.event === 'started') setState({ step: 'downloading', downloaded: 0, total: p.total });
        else if (p.event === 'chunk') setState(s => (s.step === 'downloading' ? { ...s, downloaded: p.downloaded } : s));
      });
      setState({ step: 'installed' });
    } catch (e) {
      setState({ step: 'failed', message: (e as DbError).message ?? String(e) });
    }
  };

  const ready = state.step === 'installed' || state.step === 'restarting';
  const downloading = state.step === 'downloading';
  const restart = () => {
    setState({ step: 'restarting' });
    api.restartApp().catch((e: DbError) => setState({ step: 'failed', message: e.message ?? String(e) }));
  };
  const label = ready ? `Restart to finish updating to ${update.version}`
    : downloading ? `Downloading Berth Studio ${update.version}`
    : `Berth Studio ${update.version} is available`;
  const released = update.date ? new Date(update.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="update" ref={wrap} onKeyDown={e => e.key === 'Escape' && setOpen(false)}>
      <button className={`iconbtn update-btn${ready ? ' ready' : ''}`} aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => setOpen(!open)}>
        {downloading ? <Spinner /> : <Icon name={ready ? 'restart' : 'download'} />}
        {!downloading && <i className="badge" aria-hidden="true" />}
      </button>
      {open && (
        <div className="update-panel" role="dialog" aria-label="Software update">
          <div className="update-head">
            <b>{ready ? 'Ready to restart' : `Berth Studio ${update.version}`}</b>
            <span className="faint">
              {ready ? `Version ${update.version} is installed. It starts the next time Berth Studio opens.`
                : `You have ${update.currentVersion}${released ? ` · released ${released}` : ''}`}
            </span>
          </div>

          {!ready && update.notes && <pre className="update-notes">{update.notes}</pre>}

          {state.step === 'downloading' && (
            <div className="update-progress" role="status">
              <progress max={state.total ?? undefined} value={state.total ? state.downloaded : undefined} />
              <span className="faint">
                {state.total ? `${formatBytes(state.downloaded)} of ${formatBytes(state.total)}`
                  : state.downloaded ? `${formatBytes(state.downloaded)} downloaded` : 'Connecting to GitHub…'}
              </span>
            </div>
          )}
          {state.step === 'failed' && <div className="errors" role="alert">{state.message}</div>}

          <div className="update-actions">
            <button className="btn" onClick={() => setOpen(false)}>Later</button>
            {ready
              ? <button className="btn primary" disabled={state.step === 'restarting'} onClick={restart}>
                  {state.step === 'restarting' ? <><Spinner />Restarting…</> : 'Restart now'}
                </button>
              : <button className="btn primary" disabled={downloading} onClick={install}>
                  {downloading ? <><Spinner />Downloading…</> : <><Icon name="download" />{state.step === 'failed' ? 'Try again' : 'Download and install'}</>}
                </button>}
          </div>
        </div>
      )}
    </div>
  );
}
