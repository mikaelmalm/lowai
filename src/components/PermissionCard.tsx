import { useState } from "react";
import { answeredQuestions, permissionView, questionForm, type UserQuestion } from "../chat/permission";

export function PermissionCard({
  name,
  input,
  answered,
  onAnswer,
}: {
  name: string;
  input: unknown;
  answered: "allow" | "deny" | null;
  onAnswer: (allow: boolean, input?: unknown) => void;
}) {
  const questions = questionForm(name, input);
  if (questions) {
    return <QuestionCard questions={questions} input={input} answered={answered} onAnswer={onAnswer} />;
  }
  const view = permissionView(name, input);
  return (
    <div className="permission-card">
      <strong>{view.name}</strong>
      {view.detail ? <code>{view.detail}</code> : null}
      <div className="actions">
        <button type="button" className="allow" disabled={answered != null} onClick={() => onAnswer(true)}>Allow</button>
        <button type="button" className="deny" disabled={answered != null} onClick={() => onAnswer(false)}>Deny</button>
      </div>
      {answered ? <span>{answered === "allow" ? "Allowed" : "Denied"}</span> : null}
    </div>
  );
}

function QuestionCard({
  questions,
  input,
  answered,
  onAnswer,
}: {
  questions: UserQuestion[];
  input: unknown;
  answered: "allow" | "deny" | null;
  onAnswer: (allow: boolean, input?: unknown) => void;
}) {
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const locked = answered != null;
  const answers = Object.fromEntries(
    questions.map((item) => {
      const selected = picks[item.question] ?? [];
      const custom = other[item.question]?.trim();
      const value = custom ? custom : item.multiSelect ? selected : selected[0] ?? "";
      return [item.question, value];
    }),
  );
  const ready = questions.every((item) => {
    const value = answers[item.question];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  const saved = input && typeof input === "object" ? (input as { answers?: Record<string, string | string[]> }).answers : undefined;
  return (
    <div className="permission-card questions">
      {questions.map((item) => (
        <fieldset key={item.question} className="permission-question" disabled={locked}>
          {item.header ? <legend>{item.header}</legend> : null}
          <p>{item.question}</p>
          <div className="permission-options">
            {item.options.map((option) => {
              const selected = (picks[item.question] ?? []).includes(option.label);
              return (
                <button
                  type="button"
                  key={option.label}
                  className="permission-option"
                  aria-pressed={selected}
                  onClick={() => {
                    setOther((current) => ({ ...current, [item.question]: "" }));
                    setPicks((current) => {
                      const present = current[item.question] ?? [];
                      if (item.multiSelect) {
                        return {
                          ...current,
                          [item.question]: selected
                            ? present.filter((label) => label !== option.label)
                            : [...present, option.label],
                        };
                      }
                      return { ...current, [item.question]: [option.label] };
                    });
                  }}
                >
                  <strong>{option.label}</strong>
                  {option.description ? <span>{option.description}</span> : null}
                </button>
              );
            })}
            <label className="permission-other">
              Other
              <input
                value={other[item.question] ?? ""}
                placeholder="Write your own answer"
                onChange={(event) => {
                  const value = event.target.value;
                  setOther((current) => ({ ...current, [item.question]: value }));
                  if (value.trim()) setPicks((current) => ({ ...current, [item.question]: [] }));
                }}
              />
            </label>
          </div>
        </fieldset>
      ))}
      <div className="actions">
        <button
          type="button"
          className="allow"
          disabled={locked || !ready}
          onClick={() => onAnswer(true, answeredQuestions(input, answers))}
        >
          Continue
        </button>
        <button type="button" className="deny" disabled={locked} onClick={() => onAnswer(false)}>Deny</button>
      </div>
      {answered === "deny" ? <span>Denied</span> : null}
      {answered === "allow" && saved ? (
        <span>{Object.values(saved).flat().join(" · ")}</span>
      ) : null}
    </div>
  );
}
