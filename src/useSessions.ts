import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { playTone } from "./lib/sound";
import { openSubscription } from "./lib/subscribe";
import { applyEvent, clearsAgentId, freshState, hydrate, shouldNotify } from "./state/session-rules";
import type { AgentEvent, AppState, ChatMessage, Session } from "./state/types";
import { assignTurtle } from "./theme/turtles";

type CommandFailure = { status?: string; message?: string };

export function useSessions() {
  const [state, setState] = useState<AppState>(freshState);
  const [banner, setBanner] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  const saveDisabled = useRef(false);
  const starts = useRef(new Map<string, Promise<string>>());
  const chains = useRef(new Map<string, Promise<unknown>>());
  const closed = useRef(new Set<string>());
  stateRef.current = state;

  useEffect(() => {
    return openSubscription(() =>
      listen<AgentEvent>("agent-event", (event) => {
        const payload = event.payload;
        const viewing = stateRef.current.activeSessionId;
        const focused = document.hasFocus();
        const next = applyEvent(stateRef.current, payload, viewing, focused);
        stateRef.current = next;
        setState(next);
        if (payload.kind === "turn_done" || payload.kind === "process_exited") {
          const session = next.sessions.find((item) => item.id === payload._session_id);
          if (session && shouldNotify(focused, viewing === session.id)) {
            const project = next.projects.find((item) => item.id === session.projectId)?.name ?? "Project";
            const body = payload.kind === "process_exited"
              ? "Session ended"
              : replyPreview(session) || "Reply ready";
            playTone(payload.kind === "process_exited" ? "ended" : "done");
            void notify(`${project} · ${session.label}`, body);
          }
        }
      }),
    );
  }, []);

  useEffect(() => {
    void invoke<LoadResponse>("load_app_state").then(async (response) => {
      if (response.status === "ok") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(response.json);
        } catch {
          parsed = null;
        }
        const hydrated = hydrate(parsed);
        if (hydrated.corrupt) {
          setBanner("Saved state was unreadable and was set aside.");
          await invoke("quarantine_app_state");
        }
        stateRef.current = hydrated.state;
        setState(hydrated.state);
      } else if (response.status === "corrupt") {
        setBanner(`Saved state was set aside at ${response.backup}.`);
      } else if (response.status === "ioError") {
        saveDisabled.current = true;
        setBanner(`Could not read saved state (${response.message}). Changes will not be saved this run.`);
      }
      setReady(true);
    }).catch((error: unknown) => {
      setBanner(messageOf(error));
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready || saveDisabled.current) return;
    const timer = window.setTimeout(() => {
      void invoke("save_app_state", { json: JSON.stringify(stateRef.current) }).catch((error: unknown) => {
        setBanner(messageOf(error));
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [state, ready]);

  function patch(update: (current: AppState) => AppState) {
    const next = update(stateRef.current);
    stateRef.current = next;
    setState(next);
  }

  function currentFolder(): string {
    const active = stateRef.current.sessions.find((session) => session.id === stateRef.current.activeSessionId);
    return active?.folder || ".";
  }

  function addSession(folder: string) {
    const projectId = stateRef.current.activeProjectId;
    const used = stateRef.current.sessions.filter((session) => session.projectId === projectId).map((session) => session.turtle);
    const turtle = assignTurtle(used);
    const session: Session = {
      id: crypto.randomUUID(),
      agentSessionId: null,
      projectId,
      label: folder.split(/[/\\]/).filter(Boolean).pop() || folder,
      folder,
      model: "grok-4.7",
      turtle: turtle.name,
      messages: [],
      unread: false,
      status: "asleep",
    };
    patch((current) => ({ ...current, activeSessionId: session.id, sessions: [...current.sessions, session] }));
  }

  async function browse() {
    const picked = await open({ directory: true, multiple: false, defaultPath: currentFolder() });
    if (typeof picked === "string") addSession(picked);
  }

  async function ensureRunning(session: Session): Promise<string> {
    if (session.status === "running" && session.agentSessionId) return session.agentSessionId;
    const existing = starts.current.get(session.id);
    if (existing) return existing;
    const task = invoke<string>("start_session", {
      sessionId: session.id,
      cwd: session.folder,
      model: session.model,
      agentSessionId: session.agentSessionId,
    }).then((agentSessionId) => {
      if (closed.current.has(session.id)) {
        void invoke("close_session", { sessionId: session.id });
        throw new Error("closed");
      }
      patch((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === session.id ? { ...item, agentSessionId, status: "running" } : item,
        ),
      }));
      return agentSessionId;
    }).finally(() => {
      starts.current.delete(session.id);
    });
    starts.current.set(session.id, task);
    return task;
  }

  function send(sessionId: string, text: string): Promise<{ restore?: string }> {
    const previous = chains.current.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => deliver(sessionId, text));
    chains.current.set(sessionId, next);
    return next;
  }

  async function deliver(sessionId: string, text: string): Promise<{ restore?: string }> {
    const session = stateRef.current.sessions.find((item) => item.id === sessionId);
    if (!session) return {};
    try {
      await ensureRunning(session);
      await invoke("send_message", { sessionId, text });
      const user: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
      const agent: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        model: session.model,
        blocks: [],
        done: false,
        costUsd: null,
        numTurns: null,
      };
      patch((current) => ({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === sessionId ? { ...item, messages: [...item.messages, user, agent] } : item,
        ),
      }));
      return {};
    } catch (error) {
      const info = commandFailure(error);
      if (info.status === "missingSession") {
        patch((current) => ({
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === sessionId && clearsAgentId("missing")
              ? {
                  ...item,
                  agentSessionId: null,
                  status: "asleep",
                  messages: [...item.messages, { id: crypto.randomUUID(), role: "system", text: "Couldn't resume — your next message starts a fresh conversation." }],
                }
              : item,
          ),
        }));
      } else if (info.status !== "closed") {
        patch((current) => ({
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === sessionId
              ? { ...item, messages: [...item.messages, { id: crypto.randomUUID(), role: "system", text: info.message }] }
              : item,
          ),
        }));
      }
      return { restore: text };
    }
  }

  async function changeModel(sessionId: string, model: string) {
    const session = stateRef.current.sessions.find((item) => item.id === sessionId);
    patch((current) => ({
      ...current,
      sessions: current.sessions.map((item) => (item.id === sessionId ? { ...item, model } : item)),
    }));
    if (session?.status === "running") {
      try {
        await invoke("set_model", { sessionId, model });
      } catch (error) {
        patch((current) => ({
          ...current,
          sessions: current.sessions.map((item) =>
            item.id === sessionId
              ? { ...item, messages: [...item.messages, { id: crypto.randomUUID(), role: "system", text: messageOf(error) }] }
              : item,
          ),
        }));
      }
    }
  }

  async function closeSession(sessionId: string) {
    closed.current.add(sessionId);
    await invoke("close_session", { sessionId }).catch(() => undefined);
    patch((current) => {
      const sessions = current.sessions.filter((session) => session.id !== sessionId);
      const activeSessionId = current.activeSessionId === sessionId
        ? sessions.find((session) => session.projectId === current.activeProjectId)?.id ?? null
        : current.activeSessionId;
      return { ...current, sessions, activeSessionId };
    });
  }

  return {
    state,
    banner,
    ready,
    dismissBanner: () => setBanner(null),
    selectProject: (id: string) => patch((current) => ({
      ...current,
      activeProjectId: id,
      activeSessionId: current.sessions.find((session) => session.projectId === id)?.id ?? null,
    })),
    createProject: (name: string) => patch((current) => {
      const id = crypto.randomUUID();
      return { ...current, projects: [...current.projects, { id, name }], activeProjectId: id, activeSessionId: null };
    }),
    renameProject: (id: string, name: string) => patch((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === id ? { ...project, name } : project)),
    })),
    deleteProject: (id: string) => patch((current) => {
      const projects = current.projects.filter((project) => project.id !== id);
      const activeProjectId = current.activeProjectId === id ? projects[0].id : current.activeProjectId;
      return {
        ...current,
        projects,
        activeProjectId,
        activeSessionId: current.sessions.find((session) => session.projectId === activeProjectId)?.id ?? null,
      };
    }),
    selectSession: (id: string) => patch((current) => ({
      ...current,
      activeSessionId: id,
      sessions: current.sessions.map((session) => (session.id === id ? { ...session, unread: false } : session)),
    })),
    renameSession: (id: string, label: string) => patch((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (session.id === id ? { ...session, label } : session)),
    })),
    addSession,
    browse,
    closeSession,
    setTerminalWidth: (width: number) => patch((current) => ({ ...current, terminalWidth: width })),
    send,
    changeModel,
    openLink: (url: string) => {
      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
        void openUrl(url);
      }
    },
  };
}

type LoadResponse =
  | { status: "missing" }
  | { status: "ok"; json: string }
  | { status: "corrupt"; backup: string }
  | { status: "ioError"; message: string };

function commandFailure(error: unknown): { status: string; message: string } {
  const value = asRecord(error);
  const status = typeof value?.status === "string" ? value.status : "other";
  return { status, message: typeof value?.message === "string" ? value.message : messageOf(error) };
}

function asRecord(error: unknown): CommandFailure | null {
  if (error && typeof error === "object") return error as CommandFailure;
  if (typeof error === "string") {
    try {
      return JSON.parse(error) as CommandFailure;
    } catch {
      return null;
    }
  }
  return null;
}

function messageOf(error: unknown): string {
  const value = asRecord(error);
  if (value?.message) return value.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function replyPreview(session: Session): string {
  const agent = [...session.messages].reverse().find((message) => message.role === "agent");
  if (!agent || agent.role !== "agent") return "";
  const text = agent.blocks.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join(" ");
  return text.slice(0, 80);
}

async function notify(title: string, body: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) sendNotification({ title, body });
  } catch {
    // The unread dot and the webview sound still happened.
  }
}
