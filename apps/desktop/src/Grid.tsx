// A virtualised result grid: only the rows on screen are in the DOM, so 5,000 rows stay smooth.
import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Column } from './types';
import { cellKind, display, shortType } from './logic';

const ROW = 28;

interface Props {
  columns: Column[];
  rows: (string | null)[][];
  offset?: number;
  /** When set, rows can be selected with a click. */
  selected?: number | null;
  onSelect?: (index: number) => void;
}

export function Grid({ columns, rows, offset = 0, selected, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 12 });
  const template = useMemo(() => {
    const widths = columns.map((c, i) => {
      const sample = rows.slice(0, 200).reduce((m, r) => Math.max(m, Math.min(48, (r[i] ?? 'NULL').length)), 0);
      return Math.max(72, Math.min(360, 22 + 7.6 * Math.max(sample, c.name.length, shortType(c.typeName).length)));
    });
    return `56px ${widths.map(w => `${Math.round(w)}px`).join(' ')}`;
  }, [columns, rows]);

  return (
    <div className="grid-wrap" ref={ref}>
      <div className="grid-head" style={{ gridTemplateColumns: template }}>
        <div className="faint">#</div>
        {columns.map(c => (
          <div key={c.name} className={c.primaryKey ? 'pk' : undefined} title={c.typeName}>
            <b>{c.name}</b>
            <small>{shortType(c.typeName) || ' '}</small>
          </div>
        ))}
      </div>
      <div style={{ height: v.getTotalSize(), position: 'relative', minWidth: 'max-content' }}>
        {v.getVirtualItems().map(item => {
          const r = rows[item.index];
          return (
            <div key={item.key} className={`grid-row${selected === item.index ? ' selected' : ''}`} style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)` }}
              onClick={onSelect ? () => onSelect(item.index) : undefined}>
              <div className="rn">{offset + item.index + 1}</div>
              {r.map((val, i) => (
                <div key={i} className={`c-${cellKind(val, columns[i])}`} title={val ?? 'NULL'}>{display(val, columns[i])}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
