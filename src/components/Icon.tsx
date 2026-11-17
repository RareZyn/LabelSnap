// Inline stroke icons in the wireframe style (24 × 24 grid, 1.7 px stroke, currentColor).

const PATHS: Record<string, string> = {
  home: 'M4 11.5 12 4l8 7.5M6 10v10h5v-6h2v6h5V10',
  doc: 'M6 2h9l5 5v15H6zM15 2v5h5',
  templates: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5',
  plus: 'M12 5v14M5 12h14',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM12 10.1a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z',
  close: 'M5 5l14 14M19 5 5 19',
  back: 'M15 5l-7 7 7 7',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 5l7 7-7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  image: 'M3 4h18v16H3zM8.5 8.1a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM21 15l-5-5L5 20',
  torch: 'M13 2 4 14h6l-1 8 9-12h-6z',
  grid: 'M9 3v18M15 3v18M3 9h18M3 15h18',
  switchCamera: 'M4 10a8 8 0 0 1 13.6-5.6M20 4v5h-5M20 14a8 8 0 0 1-13.6 5.6M4 20v-5h5',
  sync: 'M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1M18 3v4.5h-4.5M6 21v-4.5h4.5',
  alert: 'M12 3 2 20h20zM12 10v4M12 17v.5',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-.5 8.5z',
  cloudOff: 'M7 18a4.5 4.5 0 0 1-.6-9M10 5.6A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1 2.4 7.3M3 3l18 18',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 6.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
  logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v8h14v-8',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  rotateLeft: 'M4 4v5h5M4.5 9A8 8 0 1 1 6 17',
  rotateRight: 'M20 4v5h-5M19.5 9A8 8 0 1 0 18 17',
  crop: 'M6 2v16h16M2 6h16v16',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  select: 'M4 4h16v16H4zM8 12l3 3 5-6',
  move: 'M3 6h6l2 2h10v12H3zM12 14h6M15 11l3 3-3 3',
  duplicate: 'M8 8h12v12H8zM4 16V4h12M14 11v6M11 14h6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  text: 'M4 6V4h16v2M12 4v16M9 20h6',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  lock: 'M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3',
  location: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  drive: 'M8 3h8l6 10-4 7H6l-4-7zM8 3l6 10M16 3 8 17M2 13h20',
  contrast: 'M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  pages: 'M7 3h10v14H7zM4 7v14h10',
  zoomIn: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5M10 7v6M7 10h6',
  folder: 'M3 6h6l2 2h10v12H3z',
  bug: 'M9 7a3 3 0 0 1 6 0M7 10h10v5a5 5 0 0 1-10 0zM4 13h3M17 13h3M5 19l2.5-2M19 19l-2.5-2M5 7l2.5 2M19 7l-2.5 2',
  restore: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5',
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The LabelSnap mark (logo concept A). */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} aria-hidden="true" focusable="false">
      <path d="M36 36H82V176H186V220H36Z" fill="var(--text)" />
      <path d="M144 36H220V112H186V70H144Z" fill="var(--accent)" />
    </svg>
  );
}
