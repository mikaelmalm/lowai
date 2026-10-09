import type { AgentBlock } from "../state/types";
import { toolPresentation } from "./tools";

const FOLD_AT = 4;

type ToolBlock = Extract<AgentBlock, { type: "tool" }>;

export type PresentedBlock =
  | { kind: "single"; block: AgentBlock }
  | { kind: "run"; id: string; tools: ToolBlock[] };

export function presentBlocks(blocks: AgentBlock[]): PresentedBlock[] {
  const presented: PresentedBlock[] = [];
  let run: ToolBlock[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= FOLD_AT) presented.push({ kind: "run", id: run[0].id, tools: run });
    else for (const block of run) presented.push({ kind: "single", block });
    run = [];
  };
  for (const block of blocks) {
    if (block.type === "tool") run.push(block);
    else {
      flush();
      presented.push({ kind: "single", block });
    }
  }
  flush();
  return presented;
}

export function toolRunSummary(blocks: AgentBlock[], folder: string): string {
  const tools = blocks.filter((block): block is ToolBlock => block.type === "tool");
  const live = [...tools].reverse().find((block) => !block.done);
  if (live) {
    const view = toolPresentation(live.name, live.input, folder);
    return `${tools.length} tools · ${verbFor(live.name)} ${view.text}`;
  }
  const counts = { edit: 0, read: 0, search: 0, command: 0 };
  for (const block of tools) counts[kindOf(block.name)] += 1;
  return (["edit", "read", "search", "command"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => plural(counts[kind], kind))
    .join(", ");
}

function kindOf(name: string): "edit" | "read" | "search" | "command" {
  if (name === "search_replace" || name === "write") return "edit";
  if (name === "read_file" || name === "list_dir") return "read";
  if (name === "grep") return "search";
  return "command";
}

function verbFor(name: string): string {
  const kind = kindOf(name);
  if (kind === "edit") return "editing";
  if (kind === "read") return "reading";
  if (kind === "search") return "searching";
  return "running";
}

function plural(count: number, kind: "edit" | "read" | "search" | "command"): string {
  const word = kind === "search" ? "search" : kind;
  const many = kind === "search" ? "searches" : `${word}s`;
  return `${count} ${count === 1 ? word : many}`;
}
