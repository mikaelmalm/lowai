import { toolRunSummary } from "../chat/tool-runs";
import type { AgentBlock } from "../state/types";
import { ToolCallRow } from "./ToolCallRow";

type ToolBlock = Extract<AgentBlock, { type: "tool" }>;

export function ToolRun({ tools, folder, onOpen }: { tools: ToolBlock[]; folder: string; onOpen?: (path: string) => void }) {
  return (
    <details className="tool-run">
      <summary>{toolRunSummary(tools, folder)}</summary>
      {tools.map((block) => (
        <ToolCallRow key={block.id} name={block.name} input={block.input} folder={folder} done={block.done} onOpen={onOpen} />
      ))}
    </details>
  );
}
