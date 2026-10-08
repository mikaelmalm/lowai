import type { AgentId } from "./agents";

export const MODELS = ["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5"] as const;
export type ModelId = (typeof MODELS)[number];

export type UserMessage = { id: string; role: "user"; text: string };
export type AgentBlock =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; done: boolean }
  | { type: "permission"; id: string; name: string; input: unknown; answered: "allow" | "deny" | null };
export type AgentMessage = {
  id: string;
  role: "agent";
  model: string;
  blocks: AgentBlock[];
  done: boolean;
  costUsd: number | null;
  numTurns: number | null;
};
export type SystemMessage = { id: string; role: "system"; text: string };
export type ChatMessage = UserMessage | AgentMessage | SystemMessage;

export type Session = {
  id: string;
  agentSessionId: string | null;
  projectId: string;
  label: string;
  folder: string;
  agent: AgentId;
  model: string;
  turtle: string;
  messages: ChatMessage[];
  unread: boolean;
  status: "asleep" | "running";
  terminalWidth: number;
};

export type Project = { id: string; name: string };

export type AppState = {
  projects: Project[];
  activeProjectId: string;
  activeSessionId: string | null;
  sessions: Session[];
  sidebarWidth: number;
  sidebarHidden: boolean;
  selectedAgent: AgentId;
};

export type AgentEvent = {
  _session_id: string;
  kind: "text_delta" | "tool_start" | "tool_done" | "turn_done" | "process_exited" | "permission";
  text?: string | null;
  toolId?: string | null;
  name?: string | null;
  input?: unknown;
  costUsd?: number | null;
  numTurns?: number | null;
  stderr?: string | null;
  requestId?: string | null;
};
