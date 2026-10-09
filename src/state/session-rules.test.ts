import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_WIDTH } from "../sidebar/rules";
import { DEFAULT_TERMINAL_WIDTH } from "../terminal/rules";
import { alertTone, applyEvent, clearsAgentId, finishForLoad, folderName, hydrate, shouldNotify, withFolder } from "./session-rules";
import type { Session } from "./types";

const session = (partial: Partial<Session> = {}): Session => ({
  id: "s1",
  agentSessionId: "agent-1",
  projectId: "p",
  label: "app",
  folder: "/work/app",
  agent: "grok",
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

  it("loads the theme and defaults to dark", () => {
    const missing = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: null,
      sessions: [],
    }).state;
    expect(missing.theme).toBe("dark");
    const light = hydrate({ ...missing, theme: "light" }).state;
    expect(light.theme).toBe("light");
    const invalid = hydrate({ ...missing, theme: "sepia" }).state;
    expect(invalid.theme).toBe("dark");
  });

  it("loads a session with no agent as grok", () => {
    const saved = session();
    const { agent: _agent, ...without } = saved;
    const loaded = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      sessions: [without],
    }).state;
    expect(loaded.sessions[0].agent).toBe("grok");
    expect(loaded.sessions[0].model).toBe("grok-4.7");
    expect(loaded.selectedAgent).toBe("grok");
  });

  it("loads a gemini session as agy", () => {
    const loaded = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      sessions: [session({ agent: "gemini" as Session["agent"], model: "gemini-2.5-pro" })],
      selectedAgent: "gemini",
    }).state;
    expect(loaded.sessions[0].agent).toBe("agy");
    expect(loaded.sessions[0].model).toBe("gemini-3.8-flash-high");
    expect(loaded.selectedAgent).toBe("agy");
  });

  it("marks an open permission denied when the app loads", () => {
    const loaded = finishForLoad(session({
      messages: [{
        id: "a",
        role: "agent",
        model: "grok-4.7",
        blocks: [{ type: "permission", id: "p1", name: "Bash", input: { command: "ls" }, answered: null }],
        done: false,
        costUsd: null,
        numTurns: null,
      }],
    }));
    expect(loaded.messages[0]).toMatchObject({
      done: true,
      blocks: [{ type: "permission", answered: "deny" }],
    });
  });

  it("sets the unread dot when a permission arrives off the visible session", () => {
    const state = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      sessions: [session({ unread: false, messages: [] })],
    }).state;
    const hidden = applyEvent(state, { _session_id: "s1", kind: "permission", requestId: "p1", name: "Bash", input: { command: "ls" } }, "other", true);
    expect(hidden.sessions[0].unread).toBe(true);
    expect(hidden.sessions[0].messages[0]).toMatchObject({
      role: "agent",
      blocks: [{ type: "permission", name: "Bash" }],
    });
    const visible = applyEvent(state, { _session_id: "s1", kind: "permission", requestId: "p1", name: "Bash" }, "s1", true);
    expect(visible.sessions[0].unread).toBe(false);
    const unfocused = applyEvent(state, { _session_id: "s1", kind: "permission", requestId: "p1", name: "Bash" }, "s1", false);
    expect(unfocused.sessions[0].unread).toBe(true);
  });

  it("treats a bad saved shape as corrupt", () => {
    expect(hydrate({ nope: true }).corrupt).toBe(true);
    expect(hydrate(null).corrupt).toBe(true);
  });

  it("moves a session to a new folder and renames it when the name is still the folder", () => {
    expect(folderName("/work/app")).toBe("app");
    const moved = withFolder(session({ label: "app", folder: "/work/app" }), "/work/other");
    expect(moved.folder).toBe("/work/other");
    expect(moved.label).toBe("other");
    const named = withFolder(session({ label: "Desk", folder: "/work/app" }), "/work/other");
    expect(named.label).toBe("Desk");
    expect(named.folder).toBe("/work/other");
  });

  it("notifies unless the window is focused on that session", () => {
    expect(shouldNotify(true, true)).toBe(false);
    expect(shouldNotify(true, false)).toBe(true);
    expect(shouldNotify(false, true)).toBe(true);
  });

  it("plays a ping when a turn finishes, a tool asks, or the process exits", () => {
    expect(alertTone("turn_done")).toBe("done");
    expect(alertTone("permission")).toBe("done");
    expect(alertTone("process_exited")).toBe("ended");
    expect(alertTone("text_delta")).toBeNull();
  });

  it("stamps a reply when it opens and keeps that time", () => {
    const state = hydrate({
      projects: [{ id: "p", name: "Personal" }],
      activeProjectId: "p",
      activeSessionId: "s1",
      sessions: [session({ unread: false, messages: [] })],
    }).state;
    const opened = applyEvent(state, { _session_id: "s1", kind: "permission", requestId: "p1", name: "Bash" }, "s1", true);
    const first = opened.sessions[0].messages[0];
    expect(first.role).toBe("agent");
    if (first.role !== "agent") return;
    expect(first.openedAt).toEqual(expect.any(Number));
    const later = applyEvent(opened, { _session_id: "s1", kind: "tool_done", toolId: "p1" }, "s1", true);
    expect(later.sessions[0].messages[0]).toMatchObject({ openedAt: first.openedAt });
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
