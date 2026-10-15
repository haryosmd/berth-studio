// Asks for the connection name before a write runs in a production environment. The Rust side
// checks the typed name again; this dialog only collects it.
import { useState } from 'react';

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
