import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeMention, applyMention, mentionChoices, mentionKey, mentionTarget, type MentionEntry } from "../chat/mention";
import { isAtBottom } from "../chat/scroll";
import { isClearCommand } from "../state/session-rules";
import { modelsFor } from "../state/agents";
import type { ChatWidth, Session, Theme } from "../state/types";
import { sidebarModifier } from "../sidebar/rules";
import { readableOn, TURTLES } from "../theme/turtles";
import { AgentCard } from "./AgentCard";
import { CardErrorBoundary } from "./CardErrorBoundary";
import { ColumnWidthIcon, FileIcon, FullWidthIcon, MoonIcon, SidebarIcon, SunIcon, TerminalIcon } from "./icons";

type Props = {
  session: Session;
  onSend: (text: string) => Promise<{ restore?: string }>;
  onModel: (model: string) => void;
  onLink: (url: string) => void;
  onPermission: (requestId: string, allow: boolean, input?: unknown) => void;
  onOpenFile?: (path: string) => void;
  onTerminal: () => void;
  onFiles: () => void;
  onSidebar: () => void;
  onToggleTheme: () => void;
  onToggleWidth: () => void;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  filesOpen: boolean;
  theme: Theme;
  chatWidth: ChatWidth;
};

export function ChatTitle({ label, folder, branch }: { label: string; folder: string; branch: string | null }) {
  return (
    <div className="chat-title">
      <div className="chat-name">
        <strong>{label}</strong>
        {branch ? <span className="branch" title={`Branch ${branch}`}>{branch}</span> : null}
      </div>
      <span title={folder}>{folder}</span>
    </div>
  );
}

function useGitBranch(folder: string): string | null {
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    setBranch(null);
    const load = () => {
      void invoke<string | null>("git_branch", { cwd: folder }).then(
        (name) => { if (!stopped) setBranch(name); },
        () => { if (!stopped) setBranch(null); },
      );
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [folder]);
  return branch;
}

export function ChatView({ session, onSend, onModel, onLink, onPermission, onOpenFile, onTerminal, onFiles, onSidebar, onToggleTheme, onToggleWidth, sidebarOpen, terminalOpen, filesOpen, theme, chatWidth }: Props) {
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [dirRows, setDirRows] = useState<{ name: string; dir: boolean }[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [closedQuery, setClosedQuery] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = isAtBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
  }
  useLayoutEffect(() => {
    const el = scroller.current;
    const content = body.current;
    if (!el || !content) return;
    const pin = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [session.messages]);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const max = 176;
    el.style.maxHeight = "none";
    el.style.height = "auto";
    const full = el.scrollHeight;
    el.style.maxHeight = "";
    el.style.height = `${Math.min(full, max)}px`;
    el.style.overflowY = full > max ? "auto" : "hidden";
  }, [draft]);
  const mention = activeMention(draft, cursor);
  const target = mention ? mentionTarget(mention.query) : null;
  const menuOpen = mention != null && target != null && target.kind !== "reject" && mention.query !== closedQuery;
  const choices = menuOpen && target ? mentionChoices(target, files, dirRows) : [];
  const shown = Math.min(highlight, Math.max(choices.length - 1, 0));
  const wantsFiles = menuOpen && target?.kind === "files";
  const mentionDir = menuOpen && target?.kind === "dir" ? target.dir : null;
  useEffect(() => {
    setHighlight(0);
  }, [mention?.query]);
  useEffect(() => {
    if (!wantsFiles) return;
    let stopped = false;
    void invoke<string[]>("list_files", { cwd: session.folder }).then(
      (rows) => { if (!stopped) setFiles(rows); },
      () => { if (!stopped) setFiles([]); },
    );
    return () => { stopped = true; };
  }, [wantsFiles, session.folder]);
  useEffect(() => {
    if (mentionDir == null) return;
    let stopped = false;
    setDirRows([]);
    void invoke<{ name: string; dir: boolean }[]>("list_mention_dir", { cwd: session.folder, relative: mentionDir }).then(
      (rows) => { if (!stopped) setDirRows(rows); },
      () => { if (!stopped) setDirRows([]); },
    );
    return () => { stopped = true; };
  }, [mentionDir, session.folder]);
  function acceptMention(entry: MentionEntry) {
    if (!mention) return;
    const next = applyMention(draft, mention.start, cursor, entry.label, entry.dir);
    setDraft(next.text);
    setCursor(next.cursor);
    const caret = next.cursor;
    window.requestAnimationFrame(() => {
      const el = field.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }
  const branch = useGitBranch(session.folder);
  const turtle = TURTLES.find((item) => item.name === session.turtle) ?? TURTLES[0];
  const ink = readableOn(turtle.color);
  const models = modelsFor(session.agent);
  const modelOptions = models.includes(session.model) ? models : [session.model, ...models];
  return (
    <section className="chat" style={{ ["--turtle" as string]: turtle.color }}>
      <header className="chat-header">
        <div className="header-slot">
          <button
            type="button"
            className="icon-button"
            aria-label="Sidebar"
            aria-pressed={sidebarOpen}
            title={sidebarModifier(navigator.platform) === "meta" ? "Sidebar (⌘B)" : "Sidebar (Ctrl+B)"}
            onClick={onSidebar}
          >
            <SidebarIcon />
          </button>
        </div>
        <ChatTitle label={session.label} folder={session.folder} branch={branch} />
        <div className="header-slot end">
          <select aria-label="Model" value={session.model} onChange={(event) => onModel(event.target.value)}>
            {modelOptions.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            aria-label={theme === "light" ? "Dark mode" : "Light mode"}
            title={theme === "light" ? "Dark mode" : "Light mode"}
            onClick={onToggleTheme}
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={chatWidth === "full" ? "Column width" : "Full width"}
            aria-pressed={chatWidth === "full"}
            title={chatWidth === "full" ? "Column width" : "Full width"}
            onClick={onToggleWidth}
          >
            {chatWidth === "full" ? <ColumnWidthIcon /> : <FullWidthIcon />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Files"
            aria-pressed={filesOpen}
            title="Files"
            onClick={onFiles}
          >
            <FileIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Terminal"
            aria-pressed={terminalOpen}
            title="Terminal (Ctrl+`)"
            onClick={onTerminal}
          >
            <TerminalIcon />
          </button>
        </div>
      </header>
      <div className="transcript" ref={scroller} onScroll={onScroll}>
        <div className="transcript-body" ref={body}>
        {session.messages.map((message) => {
          if (message.role === "user") {
            return <p key={message.id} className="user-bubble" style={ink}>{message.text}</p>;
          }
          if (message.role === "system") {
            return <p key={message.id} className="system-card">{message.text}</p>;
          }
          return (
            <CardErrorBoundary key={message.id}>
              <AgentCard message={message} turtle={turtle.name} color={turtle.color} folder={session.folder} theme={theme} onLink={onLink} onPermission={onPermission} onOpenFile={onOpenFile} />
            </CardErrorBoundary>
          );
        })}
        </div>
      </div>
      <div className="composer-dock">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text || (busy && !isClearCommand(text))) return;
            setDraft("");
            setBusy(true);
            void onSend(text).then((result) => {
              if (result.restore) setDraft(result.restore);
              setBusy(false);
            });
          }}
        >
          <div className="composer-field">
            <textarea
              ref={field}
              aria-label={`Message ${turtle.name}`}
              value={draft}
              placeholder={`Message ${turtle.name}…`}
              rows={1}
              onChange={(event) => {
                setDraft(event.target.value);
                setCursor(event.target.selectionStart);
              }}
              onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
              onKeyDown={(event) => {
                if (menuOpen && choices.length > 0 && !(event.key === "Enter" && event.shiftKey)) {
                  const action = mentionKey(event.key, shown, choices.length);
                  if (action.type === "move") {
                    event.preventDefault();
                    setHighlight(action.highlight);
                    return;
                  }
                  if (action.type === "close") {
                    event.preventDefault();
                    setClosedQuery(mention?.query ?? "");
                    return;
                  }
                  if (action.type === "accept") {
                    event.preventDefault();
                    const entry = choices[shown];
                    if (entry) acceptMention(entry);
                    return;
                  }
                }
                if (event.key === "Escape" && menuOpen) {
                  event.preventDefault();
                  setClosedQuery(mention?.query ?? "");
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {menuOpen && choices.length > 0 ? (
              <div className="mention-menu" role="listbox" aria-label="Paths">
                {choices.map((entry, index) => (
                  <button
                    type="button"
                    key={`${entry.label}:${index}`}
                    role="option"
                    aria-selected={index === shown}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => acceptMention(entry)}
                  >
                    {entry.dir ? `${entry.label}/` : entry.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="submit" style={ink} disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
