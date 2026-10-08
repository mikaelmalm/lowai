import type { AgentBlock, AgentEvent } from "../state/types";

export function reduceBlocks(blocks: AgentBlock[], event: AgentEvent): AgentBlock[] {
  if (event.kind === "text_delta") {
    const text = event.text ?? "";
    const last = blocks[blocks.length - 1];
    if (last?.type === "text") {
      const next = blocks.slice();
      next[next.length - 1] = { ...last, text: last.text + text };
      return next;
    }
    return [...blocks, { type: "text", id: `text-${blocks.length}`, text }];
  }
  if ((event.kind === "tool_start" || event.kind === "tool_done") && event.toolId) {
    const index = blocks.findIndex((block) => block.type === "tool" && block.id === event.toolId);
    if (index === -1) {
      return [
        ...blocks,
        {
          type: "tool",
          id: event.toolId,
          name: event.name ?? "tool",
          input: event.input ?? null,
          done: event.kind === "tool_done",
        },
      ];
    }
    const existing = blocks[index];
    if (existing.type !== "tool") return blocks;
    const done = event.kind === "tool_done" ? true : existing.done;
    const name = event.kind === "tool_start" && event.name ? event.name : existing.name;
    const input = event.kind === "tool_start" && event.input != null ? event.input : existing.input;
    if (existing.done === done && existing.name === name && existing.input === input) return blocks;
    const next = blocks.slice();
    next[index] = { ...existing, name, input, done };
    return next;
  }
  if (event.kind === "permission" && event.requestId) {
    if (blocks.some((block) => block.type === "permission" && block.id === event.requestId)) return blocks;
    return [
      ...blocks,
      {
        type: "permission",
        id: event.requestId,
        name: event.name ?? "tool",
        input: event.input ?? null,
        answered: null,
      },
    ];
  }
  return blocks;
}

export function answerBlock(blocks: AgentBlock[], requestId: string, allow: boolean): AgentBlock[] {
  return blocks.map((block) =>
    block.type === "permission" && block.id === requestId && block.answered == null
      ? { ...block, answered: allow ? "allow" : "deny" }
      : block,
  );
}
