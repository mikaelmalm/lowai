export const DEFAULT_TERMINAL_WIDTH = 480;
export const MIN_TERMINAL_WIDTH = 240;
export const MIN_CHAT_WIDTH = 320;

export function clampTerminalWidth(width: number, available: number): number {
  const desired = Number.isFinite(width) ? width : DEFAULT_TERMINAL_WIDTH;
  if (available >= MIN_CHAT_WIDTH + MIN_TERMINAL_WIDTH) {
    const max = available - MIN_CHAT_WIDTH;
    return Math.min(Math.max(desired, MIN_TERMINAL_WIDTH), max);
  }
  return Math.min(desired, Math.max(120, Math.floor(available / 2)));
}

export function openAction(alive: boolean, exited: boolean): "spawn" | "show" {
  if (alive && !exited) return "show";
  return "spawn";
}

export function afterHide(alive: boolean): { visible: false; alive: boolean } {
  return { visible: false, alive };
}

export function afterKill(): { visible: false; alive: false; close: true } {
  return { visible: false, alive: false, close: true };
}

export function afterExit(): { alive: false; exited: true } {
  return { alive: false, exited: true };
}

export function shellCd(folder: string, platform: string): string {
  if (/win/i.test(platform)) return `Set-Location -LiteralPath '${folder.split("'").join("''")}'\r`;
  return `cd -- '${folder.split("'").join(`'\\''`)}'\n`;
}

export function routeBytes(ownerId: string, sessionId: string, chunk: Uint8Array): Uint8Array | null {
  return ownerId === sessionId ? chunk : null;
}
