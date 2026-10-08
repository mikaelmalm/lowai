export const DEFAULT_SIDEBAR_WIDTH = 280;
export const MIN_SIDEBAR_WIDTH = 180;
const MIN_CHAT_WIDTH = 320;

export function clampSidebarWidth(width: number, windowWidth: number, terminalWidth: number): number {
  const desired = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
  const max = windowWidth - MIN_CHAT_WIDTH - Math.max(0, terminalWidth);
  if (max < MIN_SIDEBAR_WIDTH) return MIN_SIDEBAR_WIDTH;
  return Math.min(Math.max(desired, MIN_SIDEBAR_WIDTH), max);
}

export function sidebarModifier(platform: string): "ctrl" | "meta" {
  return /mac/i.test(platform) ? "meta" : "ctrl";
}

export function sidebarShortcut(
  event: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; key: string },
  terminalFocused: boolean,
  modifier: "ctrl" | "meta" = "ctrl",
): boolean {
  const held = modifier === "meta" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return held && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b" && !terminalFocused;
}
