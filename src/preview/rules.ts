import { clampTerminalWidth } from "../terminal/rules";
import type { ChatMessage } from "../state/types";

export const DEFAULT_PREVIEW_WIDTH = 480;
export const MIN_PREVIEW_WIDTH = 240;

const EDIT_TOOLS = new Set(["write", "search_replace", "edit"]);
const PATH_KEYS = ["path", "file_path", "target_file", "file"];

export function clampPreviewWidth(width: number, available: number, otherPane: number): number {
  return clampTerminalWidth(width, available - Math.max(0, otherPane));
}

export function previewShortcut(
  event: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; key: string },
  terminalFocused: boolean,
  modifier: "ctrl" | "meta" = "ctrl",
): boolean {
  const held = modifier === "meta" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return held && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p" && !terminalFocused;
}

export function pathInsideFolder(path: string, folder: string): boolean {
  if (!path || !folder) return false;
  const root = folder.endsWith("/") ? folder.slice(0, -1) : folder;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    const normalized = path.replaceAll("\\", "/");
    const base = root.replaceAll("\\", "/");
    return normalized === base || normalized.startsWith(`${base}/`);
  }
  let depth = 0;
  for (const part of path.split(/[/\\]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return false;
    } else {
      depth += 1;
    }
  }
  return depth > 0;
}

export function toolOpenPath(name: string, input: unknown, folder: string): string | null {
  if (name === "grep") return null;
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value && pathInsideFolder(value, folder)) return value;
  }
  return null;
}

export function localPreviewTarget(href: string): string | null {
  if (!href || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) return null;
  return href;
}

export function speculativeOpen(kind: string, text: string): "open" | "ignore" {
  if (kind === "outside" || kind === "directory") return "ignore";
  if (kind === "missing" && !text.includes("/") && !text.includes(".")) return "ignore";
  return "open";
}

export function editedFiles(messages: ChatMessage[], folder: string): { label: "edited"; path: string }[] {
  const rows: { label: "edited"; path: string }[] = [];
  for (const message of messages) {
    if (message.role !== "agent") continue;
    for (const block of message.blocks) {
      if (block.type !== "tool" || !EDIT_TOOLS.has(block.name)) continue;
      const path = toolOpenPath(block.name, block.input, folder);
      if (!path) continue;
      const relative = relativeTo(path, folder);
      const existing = rows.findIndex((row) => row.path === relative);
      if (existing >= 0) rows.splice(existing, 1);
      rows.unshift({ label: "edited", path: relative });
    }
  }
  return rows;
}

export function filterFiles(paths: string[], query: string): string[] {
  const needle = query.toLowerCase();
  if (!needle) return paths;
  return paths.filter((path) => path.toLowerCase().includes(needle));
}

export function stillCurrent(
  request: { sessionId: string; path: string | null },
  current: { sessionId: string; path: string | null; visible: boolean },
): boolean {
  return current.visible && request.sessionId === current.sessionId && request.path === current.path;
}

export function highlightLanguage(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "rs":
      return "rust";
    case "css":
      return "css";
    case "json":
      return "json";
    case "py":
      return "python";
    default:
      return null;
  }
}

export function previewRows(
  changes: { repo: boolean; rows: { label: string; path: string }[] } | null,
  edited: { label: "edited"; path: string }[],
): { label: string; path: string }[] {
  if (!changes) return [];
  return changes.repo ? changes.rows : edited;
}

export function paletteAction(
  key: string,
  highlight: number,
  results: string[],
): { type: "move"; highlight: number } | { type: "open"; path: string } | { type: "close" } | { type: "none" } {
  if (key === "ArrowDown") return { type: "move", highlight: Math.min(highlight + 1, Math.max(results.length - 1, 0)) };
  if (key === "ArrowUp") return { type: "move", highlight: Math.max(highlight - 1, 0) };
  if (key === "Escape") return { type: "close" };
  if (key === "Enter") {
    const path = results[highlight];
    return path ? { type: "open", path } : { type: "none" };
  }
  return { type: "none" };
}

function relativeTo(path: string, folder: string): string {
  const root = folder.replaceAll("\\", "/").replace(/\/$/, "");
  const normalized = path.replaceAll("\\", "/");
  if (normalized === root) return "";
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  return normalized;
}
