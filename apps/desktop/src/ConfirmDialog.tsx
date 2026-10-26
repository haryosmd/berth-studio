// Small dialogs. ConfirmDialog asks for the connection name before a write runs in a production
// environment; the Rust side checks the typed name again, this dialog only collects it.
import { useState, type ReactNode } from 'react';

interface Props {
  connection: string;
  environment: string;
  what: string;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}

export function ConfirmDialog({ connection, environment, what, onCancel, onConfirm }: Props) {
  const [typed, setTyped] = useState('');
  return (
    <div className="scrim" role="presentation" onKeyDown={e => e.key === 'Escape' && onCancel()}>
      <form className="dialog" role="alertdialog" aria-label="Confirm production write" onSubmit={e => { e.preventDefault(); onConfirm(typed); }}>
        <h2>Write to production?</h2>
        <p className="muted" style={{ margin: 0 }}>
          {what} in <b>{connection}</b> · <b>{environment}</b>, a production environment. Type the connection name to run it once.
        </p>
        <input className="input mono" autoFocus placeholder={connection} value={typed} onChange={e => setTyped(e.target.value)} aria-label="Connection name" />
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn danger solid" disabled={typed.trim() !== connection}>Run on production</button>
        </div>
      </form>
    </div>
  );
}

/** Asks for one line of text, such as the name of a query being saved. */
export function PromptDialog({ title, label, initial, action, onCancel, onSubmit }: {
  title: string; label: string; initial?: string; action: string; onCancel: () => void; onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial ?? '');
  return (
    <div className="scrim" role="presentation" onKeyDown={e => e.key === 'Escape' && onCancel()}>
      <form className="dialog plain" role="dialog" aria-label={title} onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
        <h2>{title}</h2>
        <label className="field"><span>{label}</span>
          <input className="input" autoFocus value={value} maxLength={120} onChange={e => setValue(e.target.value)} onFocus={e => e.currentTarget.select()} />
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>{action}</button>
        </div>
      </form>
    </div>
  );
}

/** A yes or no question before something that cannot be undone, outside production. */
export function AskDialog({ title, children, action, onCancel, onConfirm }: {
  title: string; children: ReactNode; action: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="scrim" role="presentation" onKeyDown={e => e.key === 'Escape' && onCancel()}>
      <div className="dialog plain" role="alertdialog" aria-label={title}>
        <h2>{title}</h2>
        <p className="muted" style={{ margin: 0 }}>{children}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn danger solid" autoFocus onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </div>
  );
}
