import { useEffect, useState } from "react";
import type { AgentMessage, Theme } from "../state/types";
import { presentBlocks } from "../chat/tool-runs";
import { MarkdownView } from "./MarkdownView";
import { PermissionCard } from "./PermissionCard";
import { ToolCallRow } from "./ToolCallRow";
import { ToolRun } from "./ToolRun";

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
  theme,
  onLink,
  onPermission,
}: {
  message: AgentMessage;
  turtle: string;
  color: string;
  folder: string;
  theme: Theme;
  onLink: (url: string) => void;
  onPermission: (requestId: string, allow: boolean, input?: unknown) => void;
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
      {presentBlocks(message.blocks).map((item) => {
        if (item.kind === "run") return <ToolRun key={item.id} tools={item.tools} folder={folder} />;
        const block = item.block;
        if (block.type === "text") return <MarkdownView key={block.id} text={block.text} theme={theme} onLink={onLink} />;
        if (block.type === "permission") {
          return (
            <PermissionCard
              key={block.id}
              name={block.name}
              input={block.input}
              answered={block.answered}
              onAnswer={(allow, input) => onPermission(block.id, allow, input)}
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
