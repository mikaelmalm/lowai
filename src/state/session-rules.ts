import { reduceBlocks } from "../chat/blocks";
import { DEFAULT_SIDEBAR_WIDTH } from "../sidebar/rules";
import { DEFAULT_TERMINAL_WIDTH } from "../terminal/rules";
import type { AgentEvent, AppState, ChatMessage, Session } from "./types";

export function freshState(): AppState {
  const projectId = "project-personal";
  return {
    projects: [{ id: projectId, name: "Personal" }],
    activeProjectId: projectId,
    activeSessionId: null,
    sessions: [],
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarHidden: false,
  };
}

export function finishForLoad(session: Session): Session {
  return {
    ...session,
    status: "asleep",
    unread: false,
    messages: session.messages.map((message) =>
      message.role === "agent" && !message.done ? { ...message, done: true } : message,
    ),
  };
}

export function hydrate(raw: unknown): { state: AppState; corrupt: boolean } {
  if (!isState(raw)) return { state: freshState(), corrupt: true };
  const fallbackWidth = savedWidth((raw as { terminalWidth?: unknown }).terminalWidth);
  const sessions = raw.sessions.map((session) => finishForLoad({
    ...session,
    terminalWidth: savedWidth(session.terminalWidth, fallbackWidth),
  }));
  const activeProjectId = raw.projects.some((project) => project.id === raw.activeProjectId)
    ? raw.activeProjectId
    : raw.projects[0].id;
  const activeInProject = sessions.some(
    (session) => session.id === raw.activeSessionId && session.projectId === activeProjectId,
  );
  return {
    corrupt: false,
    state: {
      projects: raw.projects,
      activeProjectId,
      activeSessionId: activeInProject ? raw.activeSessionId : sessions.find((session) => session.projectId === activeProjectId)?.id ?? null,
      sessions,
      sidebarWidth: savedWidth((raw as { sidebarWidth?: unknown }).sidebarWidth, DEFAULT_SIDEBAR_WIDTH),
      sidebarHidden: raw.sidebarHidden === true,
    },
  };
}

function savedWidth(width: unknown, fallback = DEFAULT_TERMINAL_WIDTH): number {
  return typeof width === "number" && Number.isFinite(width) ? width : fallback;
}

export function clearsAgentId(kind: "missing" | "other"): boolean {
  return kind === "missing";
}

export function shouldNotify(windowFocused: boolean, viewingThisSession: boolean): boolean {
  return !(windowFocused && viewingThisSession);
}

export function applyEvent(state: AppState, event: AgentEvent, viewingSessionId: string | null, windowFocused: boolean): AppState {
  const index = state.sessions.findIndex((session) => session.id === event._session_id);
  if (index === -1) return state;
  const session = state.sessions[index];
  let next = session;
  if (event.kind === "text_delta" || event.kind === "tool_start" || event.kind === "tool_done") {
    next = updateOpenAgent(session, (message) => ({ ...message, blocks: reduceBlocks(message.blocks, event) }));
  } else if (event.kind === "turn_done") {
    const viewing = viewingSessionId === session.id && windowFocused;
    next = updateOpenAgent(session, (message) => ({
      ...message,
      done: true,
      costUsd: event.costUsd ?? null,
      numTurns: event.numTurns ?? null,
    }));
    next = { ...next, unread: viewing ? false : true, status: "running" };
  } else if (event.kind === "process_exited") {
    const stderr = (event.stderr ?? "").trim();
    const text = stderr ? `Session ended\n${stderr}` : "Session ended";
    next = updateOpenAgent(session, (message) => ({ ...message, done: true }));
    next = {
      ...next,
      status: "asleep",
      unread: shouldNotify(windowFocused, viewingSessionId === session.id),
      messages: [...next.messages, { id: `sys-${next.messages.length}`, role: "system", text }],
    };
  }
  if (next === session) return state;
  const sessions = state.sessions.slice();
  sessions[index] = next;
  return { ...state, sessions };
}

function updateOpenAgent(session: Session, edit: (message: Extract<ChatMessage, { role: "agent" }>) => Extract<ChatMessage, { role: "agent" }>): Session {
  const index = [...session.messages].reverse().findIndex((message) => message.role === "agent" && !message.done);
  if (index === -1) return session;
  const at = session.messages.length - 1 - index;
  const message = session.messages[at];
  if (message.role !== "agent") return session;
  const messages = session.messages.slice();
  messages[at] = edit(message);
  return { ...session, messages };
}

function isState(raw: unknown): raw is AppState {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as AppState;
  return Array.isArray(value.projects) && value.projects.length > 0 && Array.isArray(value.sessions) && typeof value.activeProjectId === "string";
}
