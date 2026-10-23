const MENTION_LIMIT = 8;

export type Mention = { start: number; query: string };

export type MentionTarget =
  | { kind: "files"; query: string }
  | { kind: "dir"; dir: string; prefix: string }
  | { kind: "reject" };

export type MentionEntry = { label: string; dir: boolean };

export function activeMention(text: string, cursor: number): Mention | null {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1])) return null;
  const query = before.slice(start + 1);
  if (/\s/.test(query)) return null;
  return { start, query };
}

export function mentionTarget(query: string): MentionTarget {
  if (query.startsWith("/") || query.startsWith("~") || /^[A-Za-z]:[\\/]/.test(query)) return { kind: "reject" };
  const parts = query.split(/[/\\]/);
  if (!parts.includes("..")) return { kind: "files", query };
  if (/[/\\]$/.test(query) || parts[parts.length - 1] === ".." || parts[parts.length - 1] === ".") {
    return { kind: "dir", dir: query.replace(/[/\\]+$/, "") || ".", prefix: "" };
  }
  return { kind: "dir", dir: parts.slice(0, -1).join("/") || ".", prefix: parts[parts.length - 1] ?? "" };
}

export function mentionChoices(
  target: MentionTarget,
  files: string[],
  entries: { name: string; dir: boolean }[],
): MentionEntry[] {
  if (target.kind === "reject") return [];
  if (target.kind === "files") {
    const needle = target.query.toLowerCase();
    const matched = needle ? files.filter((path) => path.toLowerCase().includes(needle)) : files;
    return matched.slice(0, MENTION_LIMIT).map((label) => ({ label, dir: false }));
  }
  const prefix = target.prefix.toLowerCase();
  return entries
    .filter((entry) => entry.name.toLowerCase().startsWith(prefix))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    .slice(0, MENTION_LIMIT)
    .map((entry) => ({ label: joinMention(target.dir, entry.name), dir: entry.dir }));
}

export function applyMention(
  text: string,
  start: number,
  cursor: number,
  label: string,
  asDir: boolean,
): { text: string; cursor: number } {
  const suffix = text.slice(cursor);
  const body = asDir ? `${label}/` : label;
  const gap = asDir || /^\s/.test(suffix) ? "" : " ";
  const next = `${text.slice(0, start)}@${body}${gap}${suffix}`;
  return { text: next, cursor: start + 1 + body.length + gap.length };
}

export function mentionKey(
  key: string,
  highlight: number,
  count: number,
): { type: "move"; highlight: number } | { type: "accept" } | { type: "close" } | { type: "none" } {
  if (key === "ArrowDown") return { type: "move", highlight: Math.min(highlight + 1, Math.max(count - 1, 0)) };
  if (key === "ArrowUp") return { type: "move", highlight: Math.max(highlight - 1, 0) };
  if (key === "Escape") return { type: "close" };
  if ((key === "Enter" || key === "Tab") && count > 0) return { type: "accept" };
  return { type: "none" };
}

function joinMention(dir: string, name: string): string {
  const base = dir.replace(/[/\\]+$/, "");
  if (!base || base === ".") return name;
  return `${base}/${name}`;
}
