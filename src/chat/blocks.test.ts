import { describe, expect, it } from "vitest";
import { reduceBlocks } from "./blocks";
import type { AgentBlock, AgentEvent } from "../state/types";

const event = (partial: Partial<AgentEvent> & Pick<AgentEvent, "kind">): AgentEvent => ({
  _session_id: "s",
  ...partial,
});

describe("reduceBlocks", () => {
  it("keeps text, tool, text in order and leaves untouched blocks identical", () => {
    const first = reduceBlocks([], event({ kind: "text_delta", text: "Hello" }));
    const withTool = reduceBlocks(first, event({ kind: "tool_start", toolId: "t1", name: "read_file", input: { path: "a.ts" } }));
    const done = reduceBlocks(withTool, event({ kind: "tool_done", toolId: "t1" }));
    const after = reduceBlocks(done, event({ kind: "text_delta", text: "Done" }));
    expect(after.map((block) => block.type)).toEqual(["text", "tool", "text"]);
    expect(after[0]).toBe(first[0]);
    expect((after[1] as AgentBlock & { type: "tool" }).done).toBe(true);
    expect((after[2] as { text: string }).text).toBe("Done");
  });

  it("appends text onto the open text block", () => {
    const once = reduceBlocks([], event({ kind: "text_delta", text: "pur" }));
    const twice = reduceBlocks(once, event({ kind: "text_delta", text: "ple" }));
    expect(twice).toHaveLength(1);
    expect((twice[0] as { text: string }).text).toBe("purple");
  });

  it("adds one permission card and ignores a repeat of the same request", () => {
    const event = {
      _session_id: "s",
      kind: "permission" as const,
      requestId: "p1",
      name: "Bash",
      input: { command: "ls" },
    };
    const first = reduceBlocks([], event);
    const again = reduceBlocks(first, event);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ type: "permission", id: "p1", name: "Bash", answered: null });
  });

  it("updates one tool row when a later start repeats the id", () => {
    const started = reduceBlocks([], event({ kind: "tool_start", toolId: "t1", name: "grep", input: { pattern: "a" } }));
    const again = reduceBlocks(started, event({ kind: "tool_start", toolId: "t1", name: "grep", input: { pattern: "ab" } }));
    expect(again).toHaveLength(1);
    expect((again[0] as { input: { pattern: string } }).input.pattern).toBe("ab");
  });
});
