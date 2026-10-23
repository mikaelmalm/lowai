import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentBlock, AgentMessage } from "../state/types";
import { AgentCard } from "./AgentCard";

function tool(id: string, name: string, done = true, input?: unknown): AgentBlock {
  return { type: "tool", id, name, input: input ?? { path: `/work/app/${id}.ts` }, done };
}

function html(blocks: AgentBlock[]): string {
  const message: AgentMessage = {
    id: "m",
    role: "agent",
    model: "grok",
    blocks,
    done: true,
    costUsd: null,
    numTurns: 1,
  };
  return renderToStaticMarkup(
    <AgentCard
      message={message}
      turtle="Leonardo"
      color="#abc"
      folder="/work/app"
      theme="dark"
      onLink={() => undefined}
      onPermission={() => undefined}
    />,
  );
}

describe("AgentCard tool runs", () => {
  it("keeps three tool calls as separate rows", () => {
    const markup = html([tool("a", "read_file"), tool("b", "read_file"), tool("c", "grep")]);
    expect(markup).not.toContain("<details");
    expect(markup.match(/tool-row/g)).toHaveLength(3);
  });

  it("folds four tool calls behind one summary", () => {
    const markup = html([
      tool("a", "read_file"),
      tool("b", "read_file"),
      tool("c", "search_replace"),
      tool("d", "write"),
    ]);
    expect(markup).toContain("<details");
    expect(markup).toContain("2 edits, 2 reads");
    expect(markup).not.toContain('open=""');
  });

  it("keeps a short path as one row", () => {
    const markup = html([tool("a", "read_file")]);
    expect(markup).toContain("a.ts");
    expect(markup).not.toContain("<details");
  });

  it("folds plain tool text past three lines", () => {
    const markup = html([tool("a", "note", true, { body: "one\ntwo\nthree\nfour" })]);
    expect(markup).toContain("<details");
    expect(markup).not.toContain('open=""');
    expect(markup).toContain("<pre");
    expect(markup).toContain("four");
  });

  it("folds a line longer than 500 characters", () => {
    const markup = html([tool("a", "note", true, { body: "z".repeat(501) })]);
    expect(markup).toContain("<details");
    expect(markup).toContain("z".repeat(501));
  });

  it("renders short markdown without a disclosure", () => {
    const markup = html([tool("a", "note", true, { body: "a **bold** word" })]);
    expect(markup).not.toContain("<details");
    expect(markup).toContain("<strong>bold</strong>");
  });

  it("renders long markdown inside a closed disclosure", () => {
    const markup = html([tool("a", "note", true, { body: "# Title\n\nsecond\n\nthird" })]);
    expect(markup).toContain("<details");
    expect(markup).not.toContain('open=""');
    expect(markup).toContain("<h1>Title</h1>");
  });
});
