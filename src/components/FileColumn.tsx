import hljs from "highlight.js";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { sidebarModifier } from "../sidebar/rules";
import { clampListHeight, DEFAULT_LIST_HEIGHT, filterFiles, highlightLanguage } from "../preview/rules";
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
  style?: CSSProperties;
};

export function FileColumn({ theme, platform, rows, repo, file, path, palette, files, query, highlight, onQuery, onOpen, onPaletteKey, style }: Props) {
  const matches = filterFiles(files, query);
  const columnRef = useRef<HTMLElement>(null);
  const [listOpen, setListOpen] = useState(true);
  const [listHeight, setListHeight] = useState(DEFAULT_LIST_HEIGHT);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = scrollRef.current;
  }, [file?.text, file?.mtimeMs]);
  useEffect(() => {
    if (palette) inputRef.current?.focus();
  }, [palette]);
  function resizeList(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const start = listHeight;
    const limit = columnRef.current?.clientHeight ?? start + 80;
    const move = (moveEvent: PointerEvent) => {
      setListHeight(clampListHeight(start + (moveEvent.clientY - startY), limit));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <aside className="file-column" style={style} ref={columnRef}>
      <div className="file-list-bar">
        <span>Changes</span>
        <button type="button" aria-pressed={listOpen} aria-label={listOpen ? "Hide changes" : "Show changes"} onClick={() => setListOpen((open) => !open)}>
          {listOpen ? "Hide" : "Show"}
        </button>
      </div>
      {listOpen ? (
        <div className="file-list" style={{ height: listHeight }}>
          {rows.map((row) => (
            <button key={`${row.label}:${row.path}`} type="button" onClick={() => onOpen(row.path)}>
              <span>{row.path}</span>
              <span>{row.label}</span>
            </button>
          ))}
          {rows.length === 0 && repo === true ? <p>No changes.</p> : null}
          {rows.length === 0 && repo === false ? <p>No git repo.</p> : null}
        </div>
      ) : null}
      {listOpen ? <div className="sash sash-row" aria-label="Resize changes" onPointerDown={resizeList} /> : null}
      <div className="file-body" ref={bodyRef} onScroll={() => { scrollRef.current = bodyRef.current?.scrollTop ?? 0; }}>{renderBody(path, file, theme, platform)}</div>
      {palette ? (
        <div className="file-palette">
          <input
            ref={inputRef}
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

