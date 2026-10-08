import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_WIDTH } from "../sidebar/rules";
import { DEFAULT_TERMINAL_WIDTH } from "../terminal/rules";
import { applyEvent, clearsAgentId, finishForLoad, hydrate, shouldNotify } from "./session-rules";
import type { Session } from "./types";

const session = (partial: Partial<Session>): Session => ({
  id: "s1",
  agentSessionId: "agent-1",
  projectId: "p",
  label: "app",
  folder: "/work/app",
  model: "grok-4.7",
  turtle: "Leonardo",
  messages: [],
  unread: true,
  status: "running",
  terminalWidth: DEFAULT_TERMINAL_WIDTH,
  ...partial,
});

describe("session rules", () => {
  it("clears the agent id only when the session is missing", () => {
    expect(clearsAgentId("missing")).toBe(true);
    expect(clearsAgentId("other")).toBe(false);
  });

  it("marks a half-finished reply done and clears unread on load", () => {
    const loaded = finishForLoad(
      session({
        unread: true,
        messages: [{ id: "a", role: "agent", model: "grok-4.7", blocks: [], done: false, costUsd: null, numTurns: null }],
      }),
    );
    expect(loaded.status).toBe("asleep");
    expect(loaded.unread).toBe(false);
    expect(loaded.messages[0]).toMatchObject({ done: true });
  });

  it("keeps a terminal width on each session", () => {
    const loaded = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      terminalWidth: 700,
      sessions: [session({ id: "s1", terminalWidth: undefined }), session({ id: "s2", terminalWidth: 360 })],
    }).state;
    expect(loaded.sessions.find((item) => item.id === "s1")?.terminalWidth).toBe(700);
    expect(loaded.sessions.find((item) => item.id === "s2")?.terminalWidth).toBe(360);
    const fresh = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      sessions: [session({ terminalWidth: Number.NaN })],
    }).state;
    expect(fresh.sessions[0].terminalWidth).toBe(DEFAULT_TERMINAL_WIDTH);
  });

  it("loads sidebar width and hidden state", () => {
    const missing = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: null,
      sessions: [],
    }).state;
    expect(missing.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(missing.sidebarHidden).toBe(false);
    const kept = hydrate({ ...missing, sidebarWidth: 360, sidebarHidden: true, sessions: [] }).state;
    expect(kept.sidebarWidth).toBe(360);
    expect(kept.sidebarHidden).toBe(true);
    const invalid = hydrate({ ...missing, sidebarWidth: "wide", sidebarHidden: "yes", sessions: [] }).state;
    expect(invalid.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(invalid.sidebarHidden).toBe(false);
  });

  it("treats a bad saved shape as corrupt", () => {
    expect(hydrate({ nope: true }).corrupt).toBe(true);
    expect(hydrate(null).corrupt).toBe(true);
  });

  it("notifies unless the window is focused on that session", () => {
    expect(shouldNotify(true, true)).toBe(false);
    expect(shouldNotify(true, false)).toBe(true);
    expect(shouldNotify(false, true)).toBe(true);
  });

  it("appends a session-ended card and goes to sleep", () => {
    const state = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      sessions: [session({ messages: [{ id: "a", role: "agent", model: "grok-4.7", blocks: [{ type: "text", id: "t", text: "hi" }], done: false, costUsd: null, numTurns: null }] })],
    }).state;
    const next = applyEvent(state, { _session_id: "s1", kind: "process_exited", stderr: "boom" }, "s1", false);
    const updated = next.sessions[0];
    expect(updated.status).toBe("asleep");
    expect(updated.messages.at(-1)).toMatchObject({ role: "system", text: "Session ended\nboom" });
    expect(updated.messages[0]).toMatchObject({ done: true });
  });
});
