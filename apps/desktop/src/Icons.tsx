// A handful of 16px line icons, drawn here so the app ships no icon font or remote asset.
import type { ReactElement } from 'react';

const P: Record<string, ReactElement> = {
  db: <><ellipse cx="8" cy="3.8" rx="5" ry="1.8" /><path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" /></>,
  table: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6.5h12M6 6.5V13" /></>,
  view: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M5 8h6M5 10.5h4" /></>,
  plus: <path d="M8 3v10M3 8h10" />,
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" />,
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" />,
  moon: <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />,
  sun: <><circle cx="8" cy="8" r="3" /><path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>,
  auto: <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></>,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  code: <path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" />,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  gear: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></>,
  chev: <path d="M6 4l4 4-4 4" />,
  chevd: <path d="M4 6l4 4 4-4" />,
  leaf: <><path d="M8 1.8c2.6 2.2 3.6 4.6 3.6 7 0 2.6-1.6 4.4-3.6 5.4-2-1-3.6-2.8-3.6-5.4 0-2.4 1-4.8 3.6-7z" /><path d="M8 4.5v10" /></>,
};

export function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function Mark({ size = 18 }: { size?: number }) {
  // The Berth Studio mark: two pills in golden ratio (design/brand/build.py).
  return (
    <svg width={size * 1.1708} height={size} viewBox="0 0 2.618 2.2361" aria-hidden="true">
      <rect width="1.618" height="1" rx="0.5" fill="#F2A93B" />
      <rect y="1.2361" width="2.618" height="1" rx="0.5" fill="currentColor" />
    </svg>
  );
}
