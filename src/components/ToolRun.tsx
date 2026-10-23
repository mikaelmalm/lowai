import { toolRunSummary } from "../chat/tool-runs";
import type { AgentBlock, Theme } from "../state/types";
import { ToolCallRow } from "./ToolCallRow";

type ToolBlock = Extract<AgentBlock, { type: "tool" }>;

export function ToolRun({
  tools,
  folder,
  onOpen,
  theme,
  onLink,
}: {
  tools: ToolBlock[];
  folder: string;
  onOpen?: (path: string) => void;
  theme: Theme;
  onLink: (url: string) => void;
}) {
  return (
    <details className="tool-run">
      <summary>{toolRunSummary(tools, folder)}</summary>
      {tools.map((block) => (
        <ToolCallRow
          key={block.id}
          name={block.name}
          input={block.input}
          folder={folder}
          done={block.done}
          onOpen={onOpen}
          theme={theme}
          onLink={onLink}
        />
      ))}
    </details>
  );
}
