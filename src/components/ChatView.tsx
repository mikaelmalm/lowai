import { useLayoutEffect, useRef, useState } from "react";
import { isAtBottom } from "../chat/scroll";
import { modelsFor } from "../state/agents";
import type { Session } from "../state/types";
import { sidebarModifier } from "../sidebar/rules";
import { readableOn, TURTLES } from "../theme/turtles";
import { AgentCard } from "./AgentCard";
import { CardErrorBoundary } from "./CardErrorBoundary";
import { SidebarIcon, TerminalIcon } from "./icons";

type Props = {
  session: Session;
  onSend: (text: string) => Promise<{ restore?: string }>;
  onModel: (model: string) => void;
  onLink: (url: string) => void;
  onPermission: (requestId: string, allow: boolean) => void;
  onTerminal: () => void;
  onSidebar: () => void;
  sidebarOpen: boolean;
  terminalOpen: boolean;
};

export function ChatView({ session, onSend, onModel, onLink, onPermission, onTerminal, onSidebar, sidebarOpen, terminalOpen }: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
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
        <div className="chat-title">
          <strong>{session.label}</strong>
          <span title={session.folder}>{session.folder}</span>
        </div>
        <div className="header-slot end">
          <select aria-label="Model" value={session.model} onChange={(event) => onModel(event.target.value)}>
            {modelOptions.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
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
              <AgentCard message={message} turtle={turtle.name} color={turtle.color} folder={session.folder} onLink={onLink} onPermission={onPermission} />
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
            if (!text || busy) return;
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
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          <button type="submit" style={ink} disabled={busy || !draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
