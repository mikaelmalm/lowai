const pen = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" {...pen} />
      <path d="M6.25 2.25v11.5" {...pen} />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.25 4.25h9.5" {...pen} />
      <path d="M6.5 4.25v-.75a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v.75" {...pen} />
      <path d="M4.75 4.25 5.2 12.6a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.45-8.35" {...pen} />
      <path d="M7 6.75v4" {...pen} />
      <path d="M9 6.75v4" {...pen} />
    </svg>
  );
}

export function TerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" {...pen} />
      <path d="M4.25 6.25 6.5 8 4.25 9.75" {...pen} />
      <path d="M8 10.25h3.75" {...pen} />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.75" {...pen} />
      <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" {...pen} />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.2 2.6A5.5 5.5 0 1 0 13.4 10 4.25 4.25 0 0 1 10.2 2.6z" {...pen} />
    </svg>
  );
}

export function ColumnWidthIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" {...pen} />
      <path d="M5.5 2.25v11.5M10.5 2.25v11.5" {...pen} />
    </svg>
  );
}

export function FullWidthIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" {...pen} />
      <path d="M4 8h8M5.5 6.25 4 8l1.5 1.75M10.5 6.25 12 8l-1.5 1.75" {...pen} />
    </svg>
  );
}
