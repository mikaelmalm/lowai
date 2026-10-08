import { useState } from "react";
import type { Session } from "../state/types";
import { MODELS } from "../state/types";
import { TURTLES } from "../theme/turtles";
import { AgentCard } from "./AgentCard";
import { CardErrorBoundary } from "./CardErrorBoundary";

type Props = {
  session: Session;
  onSend: (text: string) => Promise<{ restore?: string }>;
  onModel: (model: string) => void;
  onLink: (url: string) => void;
  onTerminal: () => void;
};

export function ChatView({ session, onSend, onModel, onLink, onTerminal }: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const turtle = TURTLES.find((item) => item.name === session.turtle) ?? TURTLES[0];
  return (
    <section className="chat" style={{ ["--turtle" as string]: turtle.color }}>
      <header className="chat-header">
        <div>
          <strong>{session.label}</strong>
          <span>{session.folder}</span>
        </div>
        <button type="button" onClick={onTerminal}>Terminal</button>
        <label>
          Model
          <select value={session.model} onChange={(event) => onModel(event.target.value)}>
            {MODELS.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>
      </header>
      <div className="transcript">
        {session.messages.map((message) => {
          if (message.role === "user") {
            return <p key={message.id} className="user-bubble" style={{ background: turtle.color }}>{message.text}</p>;
          }
          if (message.role === "system") {
            return <p key={message.id} className="system-card">{message.text}</p>;
          }
          return (
            <CardErrorBoundary key={message.id}>
              <AgentCard message={message} turtle={turtle.name} color={turtle.color} folder={session.folder} onLink={onLink} />
            </CardErrorBoundary>
          );
        })}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text || busy) return;
          setDraft("");
          setBusy(true);
          void onSend(text).then((result) => {
            if (result.restore) setDraft(result.restore);
            setBusy(false);
          });
        }}
      >
        <textarea
          value={draft}
          placeholder={`Message ${turtle.name}`}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" style={{ background: turtle.color }} disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
