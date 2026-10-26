// Export the rows on screen as CSV or JSON. The text is built here; the Rust side shows the Save
// dialog and writes only where the user chose (src-tauri/src/export.rs).
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './Icons';
import { exportName, toCsv, toJson } from './logic';
import type { DbError } from './types';

interface Props {
  /** The table, collection or query name the file is named after. */
  name: string;
  columns: string[];
  rows: (string | null)[][];
  /** JSON in its own form, such as MongoDB documents; otherwise one object per row. */
  json?: () => string;
  /** The rows are the first part of a larger result. */
  partial?: boolean;
  disabled?: boolean;
}

export function ExportMenu({ name, columns, rows, json, partial, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = async (format: 'csv' | 'json') => {
    setOpen(false);
    const contents = format === 'csv' ? toCsv(columns, rows) : json ? json() : toJson(columns, rows);
    try {
      const path = await api.saveExport(exportName(name, format), contents);
      if (!path) return;
      const file = path.split('/').pop();
      const n = rows.length.toLocaleString('en-US');
      setNote({ text: `Exported ${file} · ${n} row${rows.length === 1 ? '' : 's'}${partial ? ' (the rows loaded)' : ''}` });
    } catch (e) {
      setNote({ text: (e as DbError).message ?? String(e), bad: true });
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), 5000);
  };

  return (
    <span className="export" ref={box}>
      {note && <span className={`export-note${note.bad ? ' bad' : ''}`} role="status" title={note.text}>{note.text}</span>}
      <button className="btn" disabled={disabled || !rows.length} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        title={partial ? 'Exports the rows loaded, not the whole result' : 'Export these rows'}>
        <Icon name="download" size={14} />Export
      </button>
      {open && (
        <div className="menu" role="menu" onKeyDown={e => e.key === 'Escape' && setOpen(false)}>
          <button role="menuitem" autoFocus onClick={() => save('csv')}>CSV<span className="faint">.csv, opens in a spreadsheet</span></button>
          <button role="menuitem" onClick={() => save('json')}>JSON<span className="faint">.json, {json ? 'Extended JSON documents' : 'one object per row'}</span></button>
        </div>
      )}
    </span>
  );
}
