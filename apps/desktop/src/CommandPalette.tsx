// ⌘K: jump to a table, collection or saved query, or run an action, from the keyboard. Items come
// from what the sidebar has already loaded; nothing here queries a database.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icons';
import { fuzzyScore } from './logic';

export interface PaletteItem {
  group: string;
  icon: string;
  label: string;
  /** Shown on the right: where the item lives, or its shortcut. */
  sub?: string;
  run: () => void;
}

/** With an empty query each group shows this many; searching ranks everything. */
const PER_GROUP = 5;
const MAX_RESULTS = 60;

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const scored = query.trim()
      ? items.map(it => ({ it, score: fuzzyScore(query, `${it.label} ${it.sub ?? ''} ${it.group}`) }))
        .filter((x): x is { it: PaletteItem; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS)
        .map(x => x.it)
      : items;
    const out: { group: string; items: PaletteItem[] }[] = [];
    for (const it of scored) {
      let g = out.find(x => x.group === it.group);
      if (!g) out.push((g = { group: it.group, items: [] }));
      if (query.trim() || g.items.length < PER_GROUP) g.items.push(it);
    }
    return out;
  }, [items, query]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const pick = (it: PaletteItem | undefined) => { if (!it) return; onClose(); it.run(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[sel]); }
  };

  let n = -1;
  return (
    <div className="scrim palette-scrim" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKey}>
        <div className="pin">
          <Icon name="search" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tables, queries, actions…" spellCheck={false}
            aria-label="Search" aria-controls="palette-results" aria-activedescendant={flat.length ? `po-${sel}` : undefined} />
          <kbd>esc</kbd>
        </div>
        <div className="res" id="palette-results" ref={list} role="listbox">
          {!flat.length && <div className="pempty">No match for “{query.trim()}”. Try a table, query or action name.</div>}
          {groups.map(g => (
            <div key={g.group} role="group" aria-label={g.group}>
              <div className="pg">{g.group}</div>
              {g.items.map(it => {
                const i = ++n;
                return (
                  <div key={`${g.group}|${it.label}|${it.sub ?? ''}|${i}`} id={`po-${i}`} role="option" aria-selected={i === sel}
                    className={`po${i === sel ? ' on' : ''}`} onMouseMove={() => i !== sel && setSel(i)} onClick={() => pick(it)}>
                    <Icon name={it.icon} size={14} />
                    <span className="lb">{it.label}</span>
                    {it.sub && <span className="sb">{it.sub}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="pf">↑ ↓ move · ↵ open · esc close</div>
      </div>
    </div>
  );
}
