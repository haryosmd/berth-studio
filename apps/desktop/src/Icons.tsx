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
  gear: <><path d="M13.1 6.8L14.9 6.9L14.9 9.1L13.1 9.2L12.4 10.7L13.7 12.1L12.1 13.7L10.7 12.4L9.2 13.1L9.1 14.9L6.9 14.9L6.8 13.1L5.3 12.4L3.9 13.7L2.3 12.1L3.6 10.7L2.9 9.2L1.1 9.1L1.1 6.9L2.9 6.8L3.6 5.3L2.3 3.9L3.9 2.3L5.3 3.6L6.8 2.9L6.9 1.1L9.1 1.1L9.2 2.9L10.7 3.6L12.1 2.3L13.7 3.9L12.4 5.3z" /><circle cx="8" cy="8" r="2" /></>,
  download: <path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 12.8h10" />,
  restart: <><path d="M12.8 8A4.8 4.8 0 1 1 11.4 4.6" /><path d="M11.8 2.2v2.6H9.2" /></>,
  chev: <path d="M6 4l4 4-4 4" />,
  chevd: <path d="M4 6l4 4 4-4" />,
  leaf: <><path d="M8 1.8c2.6 2.2 3.6 4.6 3.6 7 0 2.6-1.6 4.4-3.6 5.4-2-1-3.6-2.8-3.6-5.4 0-2.4 1-4.8 3.6-7z" /><path d="M8 4.5v10" /></>,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></>,
  filter: <path d="M2 3h12l-4.5 5.5V13l-3-1.5v-3z" />,
  link: <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />,
  key: <><circle cx="5" cy="10.5" r="2.8" /><path d="m7 8.5 6.5-6.5M11 4.5l1.8 1.8M9.5 6l1.3 1.3" /></>,
  refresh: <path d="M13 3v3.5H9.5M3 13V9.5h3.5M12.6 6.5A5 5 0 0 0 3.8 5M3.4 9.5a5 5 0 0 0 8.8 1.5" />,
  sort: <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />,
  eye: <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  copy: <><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></>,
  schema: <><path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.5l1.5 1.5H12a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 13.5H4a1.5 1.5 0 0 1-1.5-1.5z" /></>,
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
