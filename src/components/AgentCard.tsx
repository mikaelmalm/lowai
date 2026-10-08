import { useEffect, useState } from "react";
import type { AgentMessage } from "../state/types";
import { MarkdownView } from "./MarkdownView";
import { PermissionCard } from "./PermissionCard";
import { ToolCallRow } from "./ToolCallRow";

const THINKING = ["Sketching the next move…", "Reading the room…", "Turning it over…", "Almost there…"];

function clock(at: number | undefined): string | null {
  if (at == null || !Number.isFinite(at)) return null;
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

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
  const stamp = clock(message.openedAt);
  return (
    <article className="agent-card" style={{ borderLeftColor: color }}>
      <header>
        <span className="agent-id">
          <span className="mark" aria-hidden="true">🐢</span>
          <strong style={{ color }}>{turtle}</strong>
        </span>
        <span className="agent-model">{message.model}</span>
        {stamp && message.openedAt != null ? <time dateTime={new Date(message.openedAt).toISOString()}>{stamp}</time> : null}
      </header>
      {message.blocks.length === 0 && !message.done ? <p className="thinking"><span aria-hidden="true">🥷</span>{THINKING[tick % THINKING.length]}</p> : null}
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
          {cost ? <span className="agent-cost"><span aria-hidden="true">🍕</span>{cost}</span> : null}
          {message.numTurns != null ? <span>{message.numTurns} turn{message.numTurns === 1 ? "" : "s"}</span> : <span>done</span>}
        </footer>
      ) : null}
    </article>
  );
}
