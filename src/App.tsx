import "highlight.js/styles/github-dark.css";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatView } from "./components/ChatView";
import { FileColumn, type PreviewBody } from "./components/FileColumn";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { TerminalPane } from "./components/TerminalPane";
import { useSessions } from "./useSessions";
import { nextProjectName } from "./state/projects";
import { clampSidebarWidth, sidebarModifier, sidebarShortcut } from "./sidebar/rules";
import { editedFiles, filterFiles, paletteAction, previewRows, previewShortcut, speculativeOpen, stillCurrent, clampPreviewWidth, DEFAULT_PREVIEW_WIDTH } from "./preview/rules";
import { clampTerminalWidth, DEFAULT_TERMINAL_WIDTH } from "./terminal/rules";
import "./theme/theme.css";

type PaneRecord = { visible: boolean; generation: number; exited: boolean };
type PreviewPane = { visible: boolean; path: string | null };
type GitChanges = { repo: boolean; rows: { label: string; path: string }[] };

export function App() {
  const api = useSessions();
  const session = api.state.sessions.find((item) => item.id === api.state.activeSessionId && item.projectId === api.state.activeProjectId) ?? null;
  const [panes, setPanes] = useState<Record<string, PaneRecord>>({});
  const [previews, setPreviews] = useState<Record<string, PreviewPane>>({});
  const [changes, setChanges] = useState<{ sessionId: string; value: GitChanges } | null>(null);
  const [previewFile, setPreviewFile] = useState<{ sessionId: string; path: string; file: PreviewBody } | null>(null);
  const [palette, setPalette] = useState(false);
  const [paletteFiles, setPaletteFiles] = useState<string[]>([]);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteHighlight, setPaletteHighlight] = useState(0);
  const [focusToken, setFocusToken] = useState(0);
  const [available, setAvailable] = useState(1200);
  const [windowWidth, setWindowWidth] = useState(1400);
  const splitRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const toggleSidebarRef = useRef(api.toggleSidebar);
  toggleSidebarRef.current = api.toggleSidebar;
  const sessionId = session?.id ?? null;
  const previewRef = useRef(previews);
  previewRef.current = previews;
  const activeRef = useRef(sessionId);
  activeRef.current = sessionId;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!sessionId || !session) return;
      const terminalFocused = Boolean(document.activeElement?.closest(".terminal-column"));
      const paletteKeys = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter" || event.key === "Escape";
      if (palette && paletteKeys && !document.activeElement?.closest(".file-palette")) {
        event.preventDefault();
        handlePaletteKey(event.key);
        return;
      }
      if (!previewShortcut(event, terminalFocused, sidebarModifier(navigator.platform))) return;
      event.preventDefault();
      setPreviews((current) => ({ ...current, [sessionId]: { visible: true, path: current[sessionId]?.path ?? null } }));
      setPalette(true);
      setPaletteQuery("");
      setPaletteHighlight(0);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  function openPreview(id: string, path: string) {
    setPreviews((current) => ({ ...current, [id]: { visible: true, path } }));
    setPalette(false);
  }

  function toggleFiles(id: string) {
    setPreviews((current) => {
      const existing = current[id] ?? { visible: false, path: null };
      return { ...current, [id]: { ...existing, visible: !existing.visible } };
    });
  }

  function handlePaletteKey(key: string) {
    if (!session) return;
    const matches = filterFiles(paletteFiles, paletteQuery);
    const action = paletteAction(key, paletteHighlight, matches);
    if (action.type === "move") setPaletteHighlight(action.highlight);
    if (action.type === "close") setPalette(false);
    if (action.type === "open") openPreview(session.id, action.path);
  }

  async function openMentioned(text: string) {
    if (!session) return;
    const id = session.id;
    const result = await invoke<PreviewBody>("read_preview", { cwd: session.folder, path: text });
    if (activeRef.current !== id) return;
    if (speculativeOpen(result.kind, text) === "ignore") return;
    openPreview(id, text);
    setPreviewFile({ sessionId: id, path: text, file: result });
  }

  const previewPane = sessionId ? previews[sessionId] : undefined;
  const previewVisible = Boolean(previewPane?.visible);
  const previewPath = previewPane?.path ?? null;
  const paneVisible = sessionId ? Boolean(panes[sessionId]?.visible) : false;
  const savedTerminal = session?.terminalWidth ?? DEFAULT_TERMINAL_WIDTH;
  const savedPreview = session?.previewWidth ?? DEFAULT_PREVIEW_WIDTH;
  const previewWidth = previewVisible ? clampPreviewWidth(savedPreview, available, paneVisible ? savedTerminal : 0) : 0;
  const width = paneVisible ? clampTerminalWidth(savedTerminal, available - previewWidth) : 0;
  const sidebarWidth = clampSidebarWidth(api.state.sidebarWidth, windowWidth, paneVisible ? width : 0, previewVisible ? previewWidth : 0);
  const shownChanges = changes?.sessionId === sessionId ? changes.value : null;
  const shownFile = previewFile && previewFile.sessionId === sessionId && previewFile.path === previewPath ? previewFile.file : null;
  const rows = previewRows(shownChanges, session ? editedFiles(session.messages, session.folder) : []);

  useEffect(() => {
    setPalette(false);
    setPaletteQuery("");
  }, [sessionId]);

  useEffect(() => {
    if (!session || !previewVisible) return;
    let stopped = false;
    const id = session.id;
    const folder = session.folder;
    const load = () => {
      void invoke<GitChanges>("git_changes", { cwd: folder }).then((result) => {
        if (stopped || activeRef.current !== id || !previewRef.current[id]?.visible) return;
        setChanges({ sessionId: id, value: result });
      });
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [session?.id, session?.folder, previewVisible]);

  useEffect(() => {
    if (!session || !previewVisible || !previewPath) return;
    let stopped = false;
    const request = { sessionId: session.id, path: previewPath };
    const folder = session.folder;
    const load = () => {
      void invoke<PreviewBody>("read_preview", { cwd: folder, path: previewPath }).then((result) => {
        if (stopped) return;
        const pane = previewRef.current[request.sessionId];
        if (!stillCurrent(request, { sessionId: activeRef.current ?? "", path: pane?.path ?? null, visible: Boolean(pane?.visible) })) return;
        setPreviewFile((current) => {
          if (current && current.sessionId === request.sessionId && current.path === request.path && current.file.mtimeMs != null && current.file.mtimeMs === result.mtimeMs && current.file.kind === result.kind) return current;
          return { sessionId: request.sessionId, path: request.path, file: result };
        });
      });
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [session?.id, session?.folder, previewVisible, previewPath]);

  useEffect(() => {
    if (!palette || !session) return;
    let stopped = false;
    const folder = session.folder;
    void invoke<string[]>("list_files", { cwd: folder }).then((files) => {
      if (!stopped) setPaletteFiles(files);
    });
    return () => { stopped = true; };
  }, [palette, session?.id, session?.folder]);

  return (
    <div className="window" data-theme={api.state.theme} data-chat-width={api.state.chatWidth}>
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
          setPreviews((current) => {
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
              api.setSidebarWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX), bounds, reserve, 0));
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
                onPermission={(requestId, allow, input) => api.answerPermission(session.id, requestId, allow, input)}
                onOpenFile={(path) => { void openMentioned(path); }}
                onTerminal={() => (paneVisible ? hideTerminal(session.id) : openTerminal(session.id))}
                onFiles={() => toggleFiles(session.id)}
                onSidebar={api.toggleSidebar}
                onToggleTheme={api.toggleTheme}
                onToggleWidth={api.toggleChatWidth}
                sidebarOpen={!api.state.sidebarHidden}
                terminalOpen={paneVisible}
                filesOpen={previewVisible}
                theme={api.state.theme}
                chatWidth={api.state.chatWidth}
              />
            </div>
            {previewVisible ? (
              <div
                className="sash"
                onPointerDown={(event) => {
                  event.preventDefault();
                  const startX = event.clientX;
                  const startWidth = previewWidth;
                  const bounds = splitRef.current?.clientWidth ?? available;
                  function move(moveEvent: PointerEvent) {
                    if (sessionId) api.setPreviewWidth(sessionId, clampPreviewWidth(startWidth - (moveEvent.clientX - startX), bounds, paneVisible ? savedTerminal : 0));
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
            {previewVisible ? (
              <FileColumn
                folder={session.folder}
                theme={api.state.theme}
                platform={navigator.platform}
                rows={rows}
                repo={shownChanges ? shownChanges.repo : null}
                file={shownFile}
                path={previewPath}
                palette={palette}
                files={paletteFiles}
                query={paletteQuery}
                highlight={paletteHighlight}
                onQuery={(query) => { setPaletteQuery(query); setPaletteHighlight(0); }}
                onOpen={(path) => openPreview(session.id, path)}
                onPaletteKey={handlePaletteKey}
                style={{ width: previewWidth }}
              />
            ) : null}
            {paneVisible ? (
              <div
                className="sash"
                onPointerDown={(event) => {
                  event.preventDefault();
                  const startX = event.clientX;
                  const startWidth = width;
                  const bounds = (splitRef.current?.clientWidth ?? available) - previewWidth;
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
                  width={session.id === id && paneVisible ? width : clampTerminalWidth(owner.terminalWidth, available)}
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
