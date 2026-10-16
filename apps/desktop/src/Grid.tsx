// A virtualised result grid: only the rows on screen are in the DOM, so 5,000 rows stay smooth.
import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from './Icons';
import type { Column, Sort } from './types';
import { cellKind, display, fkLabel, shortType } from './logic';

const ROW = 28;

interface Props {
  columns: Column[];
  rows: (string | null)[][];
  offset?: number;
  /** When set, rows can be selected with a click. */
  selected?: number | null;
  onSelect?: (index: number) => void;
  /** Original indexes of the rows to show; every row when absent. Row numbers keep the original index. */
  visible?: number[];
  /** Cells whose text contains this are marked. */
  highlight?: string;
  sort?: Sort | null;
  /** When set, headers are clickable and ask for that column; the view picks the direction. */
  onSort?: (column: string) => void;
  /** When set, a foreign-key cell shows a link that asks to open the row it points at. */
  onFollow?: (row: number, col: number) => void;
}

export function Grid({ columns, rows, offset = 0, selected, onSelect, visible, highlight, sort, onSort, onFollow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const count = visible ? visible.length : rows.length;
  const v = useVirtualizer({ count, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 12 });
  const template = useMemo(() => {
    const widths = columns.map((c, i) => {
      const sample = rows.slice(0, 200).reduce((m, r) => Math.max(m, Math.min(48, (r[i] ?? 'NULL').length)), 0);
      const head = Math.max(c.name.length, shortType(c.typeName).length + (c.fk ? fkLabel(c.fk).length + 2 : 0));
      return Math.max(72, Math.min(360, 22 + 7.6 * Math.max(sample, head)));
    });
    return `56px ${widths.map(w => `${Math.round(w)}px`).join(' ')}`;
  }, [columns, rows]);
  const needle = highlight?.trim().toLowerCase();

  return (
    <div className="grid-wrap" ref={ref}>
      <div className="grid-head" style={{ gridTemplateColumns: template }}>
        <div className="faint">#</div>
        {columns.map(c => {
          const dir = sort?.column === c.name ? (sort.descending ? 'descending' : 'ascending') : undefined;
          const cls = `${c.primaryKey ? 'pk' : ''}${onSort ? ' sortable' : ''}`.trim();
          return (
            <div key={c.name} className={cls || undefined} title={onSort ? `${c.typeName ?? ''}\nClick to sort by ${c.name}`.trim() : c.typeName}
              role={onSort ? 'columnheader' : undefined} aria-sort={dir} onClick={onSort ? () => onSort(c.name) : undefined}>
              <b>{c.name}{dir && <span className="sortmark" aria-hidden="true">{dir === 'ascending' ? '▲' : '▼'}</span>}</b>
              <small>
                {shortType(c.typeName) || ' '}
                {c.fk && <span className="fkref" title={`References ${c.fk.schema}.${c.fk.table}.${c.fk.column}`}><Icon name="link" size={10} />{fkLabel(c.fk)}</span>}
              </small>
            </div>
          );
        })}
      </div>
      <div style={{ height: v.getTotalSize(), position: 'relative', minWidth: 'max-content' }}>
        {v.getVirtualItems().map(item => {
          const oi = visible ? visible[item.index] : item.index;
          const r = rows[oi];
          return (
            <div key={item.key} className={`grid-row${selected === oi ? ' selected' : ''}`} style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
              onClick={onSelect ? () => onSelect(oi) : undefined}>
              <div className="rn">{offset + oi + 1}</div>
              {r.map((val, i) => {
                const fk = columns[i]?.fk;
                const hit = needle && val !== null && val.toLowerCase().includes(needle) ? ' hit' : '';
                return (
                  <div key={i} className={`c-${cellKind(val, columns[i])}${fk ? ' c-fk' : ''}${hit}`} title={val ?? 'NULL'}>
                    {display(val, columns[i])}
                    {fk && onFollow && val !== null && (
                      <button type="button" className="lk" aria-label={`Open ${fk.table} where ${fk.column} = ${val}`} title={`Open ${fk.table} where ${fk.column} = ${val}`}
                        onClick={e => { e.stopPropagation(); onFollow(oi, i); }}>
                        <Icon name="link" size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
