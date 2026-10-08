import "highlight.js/styles/github.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatView } from "./components/ChatView";
import { Sidebar } from "./components/Sidebar";
import { TerminalPane } from "./components/TerminalPane";
import { useSessions } from "./useSessions";
import { clampTerminalWidth } from "./terminal/rules";
import "./theme/theme.css";

type PaneRecord = { visible: boolean; generation: number; exited: boolean };

export function App() {
  const api = useSessions();
  const session = api.state.sessions.find((item) => item.id === api.state.activeSessionId && item.projectId === api.state.activeProjectId) ?? null;
  const [panes, setPanes] = useState<Record<string, PaneRecord>>({});
  const [focusToken, setFocusToken] = useState(0);
  const [available, setAvailable] = useState(1200);
  const splitRef = useRef<HTMLDivElement>(null);
  const sessionId = session?.id ?? null;

  useEffect(() => {
    const element = splitRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth));
    observer.observe(element);
    setAvailable(element.clientWidth);
    return () => observer.disconnect();
  }, [sessionId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!sessionId || !event.ctrlKey || event.key !== "`") return;
      event.preventDefault();
      openTerminal(sessionId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionId, panes]);

  function openTerminal(id: string) {
    setPanes((current) => {
      const existing = current[id];
      if (existing?.visible && !existing.exited) return current;
      const generation = existing?.exited ? existing.generation + 1 : existing?.generation ?? 0;
      return { ...current, [id]: { visible: true, generation, exited: false } };
    });
    setFocusToken((value) => value + 1);
  }

  function hideTerminal(id: string) {
    setPanes((current) => current[id] ? { ...current, [id]: { ...current[id], visible: false } } : current);
  }

  function killTerminal(id: string) {
    void invoke("close_terminal", { sessionId: id });
    setPanes((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const width = clampTerminalWidth(api.state.terminalWidth, available);
  const paneVisible = sessionId ? Boolean(panes[sessionId]?.visible) : false;

  return (
    <div className="app">
      <Sidebar
        state={api.state}
        onProject={api.selectProject}
        onCreateProject={api.createProject}
        onRenameProject={api.renameProject}
        onDeleteProject={api.deleteProject}
        onSelect={api.selectSession}
        onRename={api.renameSession}
        onClose={(id) => {
          setPanes((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
          void api.closeSession(id);
        }}
        onNewSession={() => api.addSession(session?.folder || ".")}
        onBrowse={() => { void api.browse(); }}
        onTypedFolder={api.addSession}
      />
      <main>
        {api.banner ? (
          <div className="banner">
            <span>{api.banner}</span>
            <button type="button" onClick={api.dismissBanner}>Dismiss</button>
          </div>
        ) : null}
        {session ? (
          <div className="session-split" ref={splitRef}>
            <div className="chat-column">
              <ChatView
                key={session.id}
                session={session}
                onSend={(text) => api.send(session.id, text)}
                onModel={(model) => { void api.changeModel(session.id, model); }}
                onLink={api.openLink}
                onTerminal={() => openTerminal(session.id)}
              />
            </div>
            {paneVisible ? (
              <div
                className="sash"
                onPointerDown={(event) => {
                  event.preventDefault();
                  const startX = event.clientX;
                  const startWidth = width;
                  const bounds = splitRef.current?.clientWidth ?? available;
                  function move(moveEvent: PointerEvent) {
                    api.setTerminalWidth(clampTerminalWidth(startWidth - (moveEvent.clientX - startX), bounds));
                  }
                  function up() {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  }
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              />
            ) : null}
            {Object.entries(panes).map(([id, pane]) => {
              const owner = api.state.sessions.find((item) => item.id === id);
              if (!owner) return null;
              return (
                <TerminalPane
                  key={`${id}-${pane.generation}`}
                  sessionId={id}
                  folder={owner.folder}
                  width={width}
                  hidden={!(session.id === id && pane.visible)}
                  focusToken={focusToken}
                  onHide={() => hideTerminal(id)}
                  onKill={() => killTerminal(id)}
                  onExited={() => setPanes((current) => current[id] ? { ...current, [id]: { ...current[id], exited: true } } : current)}
                />
              );
            })}
          </div>
        ) : (
          <section className="empty">
            <h1>AI Shell</h1>
            <p>Open a folder to start a Grok session. Sessions in other projects keep running.</p>
          </section>
        )}
      </main>
    </div>
  );
}
