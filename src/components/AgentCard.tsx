import { useEffect, useState } from "react";
import type { AgentMessage } from "../state/types";
import { MarkdownView } from "./MarkdownView";
import { PermissionCard } from "./PermissionCard";
import { ToolCallRow } from "./ToolCallRow";

const THINKING = ["Sketching the next move…", "Reading the room…", "Turning it over…", "Almost there…"];

export function AgentCard({
  message,
  turtle,
  color,
  folder,
  onLink,
  onPermission,
}: {
  message: AgentMessage;
  turtle: string;
  color: string;
  folder: string;
  onLink: (url: string) => void;
  onPermission: (requestId: string, allow: boolean) => void;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (message.done) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 2400);
    return () => window.clearInterval(timer);
  }, [message.done]);
  const cost = message.costUsd == null ? null : `$${message.costUsd.toFixed(4)}`;
  return (
    <article className="agent-card" style={{ borderLeftColor: color }}>
      <header>
        <strong style={{ color }}>{turtle}</strong>
        <span>{message.model}</span>
      </header>
      {message.blocks.length === 0 && !message.done ? <p className="thinking">{THINKING[tick % THINKING.length]}</p> : null}
      {message.blocks.map((block) => {
        if (block.type === "text") return <MarkdownView key={block.id} text={block.text} onLink={onLink} />;
        if (block.type === "permission") {
          return (
            <PermissionCard
              key={block.id}
              name={block.name}
              input={block.input}
              answered={block.answered}
              onAnswer={(allow) => onPermission(block.id, allow)}
            />
          );
        }
        return <ToolCallRow key={block.id} name={block.name} input={block.input} folder={folder} done={block.done} />;
      })}
      {message.done ? (
        <footer>
          {cost ? <span>{cost}</span> : null}
          {message.numTurns != null ? <span>{message.numTurns} turn{message.numTurns === 1 ? "" : "s"}</span> : <span>done</span>}
        </footer>
      ) : null}
    </article>
  );
}
