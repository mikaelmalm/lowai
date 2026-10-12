import hljs from "highlight.js";
import { sidebarModifier } from "../sidebar/rules";
import { filterFiles, highlightLanguage } from "../preview/rules";
import type { Theme } from "../state/types";
import { MarkdownView } from "./MarkdownView";

export type PreviewBody = {
  kind: string;
  text: string | null;
  truncated: boolean;
  error: string | null;
  mtimeMs: number | null;
};

type Row = { label: string; path: string };

type Props = {
  folder: string;
  theme: Theme;
  platform: string;
  rows: Row[];
  repo: boolean | null;
  file: PreviewBody | null;
  path: string | null;
  palette: boolean;
  files: string[];
  query: string;
  highlight: number;
  onQuery: (query: string) => void;
  onOpen: (path: string) => void;
  onPaletteKey: (key: string) => void;
};

export function FileColumn({ theme, platform, rows, repo, file, path, palette, files, query, highlight, onQuery, onOpen, onPaletteKey }: Props) {
  const matches = filterFiles(files, query);
  return (
    <aside className="file-column">
      <div className="file-list">
        {rows.map((row) => (
          <button key={`${row.label}:${row.path}`} type="button" onClick={() => onOpen(row.path)}>
            <span>{row.path}</span>
            <span>{row.label}</span>
          </button>
        ))}
        {rows.length === 0 && repo === true ? <p>No changes.</p> : null}
        {rows.length === 0 && repo === false ? <p>No git repo.</p> : null}
      </div>
      <div className="file-body">{renderBody(path, file, theme, platform)}</div>
      {palette ? (
        <div className="file-palette">
          <input
            aria-label="Open file"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                onPaletteKey(event.key);
              }
            }}
          />
          {matches.map((match, index) => (
            <button key={match} type="button" aria-selected={index === highlight} onClick={() => onOpen(match)}>
              {match}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function renderBody(path: string | null, file: PreviewBody | null, theme: Theme, platform: string) {
  if (!path) {
    return <p>{sidebarModifier(platform) === "meta" ? "Press ⌘P to open a file." : "Press Ctrl+P to open a file."}</p>;
  }
  if (!file) return null;
  if (file.kind === "missing") return <p>The file was deleted.</p>;
  if (file.kind === "binary") return <p>This file cannot be previewed.</p>;
  if (file.kind === "error") return <p>{file.error}</p>;
  if (file.kind === "directory" || file.kind === "outside") return null;
  const truncated = file.truncated ? <p>The rest of this file was not loaded.</p> : null;
  if (file.kind === "markdown") {
    return (
      <>
        <MarkdownView text={file.text ?? ""} theme={theme} onLink={() => undefined} />
        {truncated}
      </>
    );
  }
  return (
    <>
      <CodeText path={path} text={file.text ?? ""} />
      {truncated}
    </>
  );
}

function CodeText({ path, text }: { path: string; text: string }) {
  const language = highlightLanguage(path);
  if (!language) return <pre><code>{text}</code></pre>;
  try {
    const html = hljs.highlight(text, { language }).value;
    return <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>;
  } catch {
    return <pre><code>{text}</code></pre>;
  }
}

