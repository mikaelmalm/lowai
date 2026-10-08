import { describe, expect, it } from "vitest";
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

  it("fills a default terminal width when the save has none", () => {
    const loaded = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: null,
      sessions: [],
    }).state;
    expect(loaded.terminalWidth).toBe(DEFAULT_TERMINAL_WIDTH);
    const kept = hydrate({ ...loaded, terminalWidth: 640 }).state;
    expect(kept.terminalWidth).toBe(640);
    const invalid = hydrate({ ...loaded, terminalWidth: Number.POSITIVE_INFINITY }).state;
    expect(invalid.terminalWidth).toBe(DEFAULT_TERMINAL_WIDTH);
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
