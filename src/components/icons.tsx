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

export function TerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" {...pen} />
      <path d="M4.25 6.25 6.5 8 4.25 9.75" {...pen} />
      <path d="M8 10.25h3.75" {...pen} />
    </svg>
  );
}
