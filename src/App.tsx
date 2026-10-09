import "highlight.js/styles/github-dark.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatView } from "./components/ChatView";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { TerminalPane } from "./components/TerminalPane";
import { useSessions } from "./useSessions";
import { nextProjectName } from "./state/projects";
import { clampSidebarWidth, sidebarModifier, sidebarShortcut } from "./sidebar/rules";
import { clampTerminalWidth, DEFAULT_TERMINAL_WIDTH } from "./terminal/rules";
import "./theme/theme.css";

type PaneRecord = { visible: boolean; generation: number; exited: boolean };

export function App() {
  const api = useSessions();
  const session = api.state.sessions.find((item) => item.id === api.state.activeSessionId && item.projectId === api.state.activeProjectId) ?? null;
  const [panes, setPanes] = useState<Record<string, PaneRecord>>({});
  const [focusToken, setFocusToken] = useState(0);
  const [available, setAvailable] = useState(1200);
  const [windowWidth, setWindowWidth] = useState(1400);
  const splitRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const toggleSidebarRef = useRef(api.toggleSidebar);
  toggleSidebarRef.current = api.toggleSidebar;
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
    const element = appRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWindowWidth(element.clientWidth));
    observer.observe(element);
    setWindowWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const terminalFocused = Boolean(document.activeElement?.closest(".terminal-column"));
      if (!sidebarShortcut(event, terminalFocused, sidebarModifier(navigator.platform))) return;
      event.preventDefault();
      toggleSidebarRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const width = clampTerminalWidth(session?.terminalWidth ?? DEFAULT_TERMINAL_WIDTH, available);
  const paneVisible = sessionId ? Boolean(panes[sessionId]?.visible) : false;
  const sidebarWidth = clampSidebarWidth(api.state.sidebarWidth, windowWidth, paneVisible ? width : 0);

  return (
    <div className="window" data-theme={api.state.theme}>
    <TitleBar />
    <div className="app" ref={appRef}>
      {api.state.sidebarHidden ? null : (
        <Sidebar
          style={{ width: sidebarWidth }}
        state={api.state}
        onProject={api.selectProject}
        onNewProject={() => api.createProject(nextProjectName(api.state.projects))}
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
        agents={api.agents}
        onAgent={api.setAgent}
        onNewSession={() => api.addSession(session?.folder || ".")}
        onBrowse={() => { void api.browse(); }}
        onToggleTheme={api.toggleTheme}
        />
      )}
      {api.state.sidebarHidden ? null : (
        <div
          className="sash"
          onPointerDown={(event) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = sidebarWidth;
            const bounds = appRef.current?.clientWidth ?? windowWidth;
            const reserve = paneVisible ? width : 0;
            function move(moveEvent: PointerEvent) {
              api.setSidebarWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX), bounds, reserve));
            }
            function up() {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            }
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      )}
      <main>
        {api.banner ? (
          <div className="banner">
            <span>{api.banner}</span>
            <button type="button" className="control" onClick={api.dismissBanner}>Dismiss</button>
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
                onPermission={(requestId, allow) => api.answerPermission(session.id, requestId, allow)}
                onTerminal={() => (paneVisible ? hideTerminal(session.id) : openTerminal(session.id))}
                onSidebar={api.toggleSidebar}
                sidebarOpen={!api.state.sidebarHidden}
                terminalOpen={paneVisible}
                theme={api.state.theme}
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
                    if (sessionId) api.setTerminalWidth(sessionId, clampTerminalWidth(startWidth - (moveEvent.clientX - startX), bounds));
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
                  width={clampTerminalWidth(owner.terminalWidth, available)}
                  hidden={!(session.id === id && pane.visible)}
                  focusToken={focusToken}
                  theme={api.state.theme}
                  onKill={() => killTerminal(id)}
                  onExited={() => setPanes((current) => current[id] ? { ...current, [id]: { ...current[id], exited: true } } : current)}
                />
              );
            })}
          </div>
        ) : (
          <section className="empty">
            {api.state.sidebarHidden ? (
              <button type="button" className="control" onClick={api.toggleSidebar}>Show sidebar</button>
            ) : null}
            <h1>lowai</h1>
            {api.ready && api.agents.length === 0 ? (
              <p className="system-card">No agent CLI was found.</p>
            ) : (
              <p>Open a folder to start a session. Sessions in other projects keep running.</p>
            )}
          </section>
        )}
      </main>
    </div>
    </div>
  );
}
