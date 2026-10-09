import { describe, expect, it } from "vitest";
import type { AgentBlock } from "../state/types";
import { presentBlocks, toolRunSummary } from "./tool-runs";

function tool(id: string, name: string, input: unknown = null, done = true): AgentBlock {
  return { type: "tool", id, name, input, done };
}

describe("presentBlocks", () => {
  it("leaves a run of three tools as separate rows", () => {
    const blocks = [tool("a", "read_file"), tool("b", "read_file"), tool("c", "grep")];
    expect(presentBlocks(blocks)).toEqual(blocks.map((block) => ({ kind: "single", block })));
  });

  it("folds four consecutive tools into one run", () => {
    const blocks = [tool("a", "read_file"), tool("b", "read_file"), tool("c", "grep"), tool("d", "write")];
    expect(presentBlocks(blocks)).toEqual([{ kind: "run", id: "a", tools: blocks }]);
  });

  it("splits a run at text and at a permission card", () => {
    const left = [tool("a", "read_file"), tool("b", "read_file")];
    const right = [tool("c", "grep"), tool("d", "grep"), tool("e", "grep"), tool("f", "grep")];
    const text: AgentBlock = { type: "text", id: "t", text: "next" };
    const permission: AgentBlock = { type: "permission", id: "p", name: "write", input: null, answered: null };
    const blocks = [...left, text, ...right, permission];
    expect(presentBlocks(blocks)).toEqual([
      { kind: "single", block: left[0] },
      { kind: "single", block: left[1] },
      { kind: "single", block: text },
      { kind: "run", id: "c", tools: right },
      { kind: "single", block: permission },
    ]);
  });
});

describe("toolRunSummary", () => {
  const folder = "/work/app";

  it("names the live call while one is still running", () => {
    const tools = [
      tool("a", "read_file", { path: "/work/app/src/a.ts" }),
      tool("b", "read_file", { path: "/work/app/src/b.ts" }),
      tool("c", "grep", { pattern: "load" }),
      tool("d", "read_file", { path: "/work/app/src/session.rs" }, false),
    ];
    expect(toolRunSummary(tools, folder)).toBe("4 tools · reading src/session.rs");
  });

  it("counts a finished run by kind, edits first", () => {
    const tools = [
      ...Array.from({ length: 9 }, (_, i) => tool(`r${i}`, "read_file", { path: `/work/app/f${i}.ts` })),
      ...Array.from({ length: 3 }, (_, i) => tool(`g${i}`, "grep", { pattern: "x" })),
      tool("e1", "search_replace", { path: "/work/app/a.ts" }),
      tool("e2", "write", { file_path: "/work/app/b.ts" }),
      tool("c1", "run_terminal_command", { command: "echo" }),
    ];
    expect(toolRunSummary(tools, folder)).toBe("2 edits, 9 reads, 3 searches, 1 command");
  });
});
