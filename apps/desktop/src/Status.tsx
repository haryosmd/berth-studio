// Loading and empty states, shared so every screen waits and explains itself the same way.
import type { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Fills a pane while it loads, or when there is nothing to show. */
export function Placeholder({ loading, title, children }: { loading?: boolean; title: string; children?: ReactNode }) {
  return (
    <div className="placeholder" role={loading ? 'status' : undefined} aria-busy={loading || undefined}>
      {loading && <Spinner />}
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

/** One line in the sidebar tree: loading, empty or failed. */
export function TreeNote({ depth, loading, error, children }: { depth?: 'child' | 'grandchild'; loading?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className={`node${depth ? ` ${depth}` : ''} note-row${error ? ' bad' : ''}`} title={error} role={loading ? 'status' : undefined}>
      {loading && <Spinner />}<span className="lbl">{children}</span>
    </div>
  );
}
