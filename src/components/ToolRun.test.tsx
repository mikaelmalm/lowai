import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentBlock, AgentMessage } from "../state/types";
import { AgentCard } from "./AgentCard";

function tool(id: string, name: string, done = true): AgentBlock {
  return { type: "tool", id, name, input: { path: `/work/app/${id}.ts` }, done };
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
});
