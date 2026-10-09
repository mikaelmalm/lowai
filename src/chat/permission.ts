export type QuestionOption = { label: string; description: string };
export type UserQuestion = {
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
};

export function isAskUserQuestion(name: string): boolean {
  const normalized = name.replace(/[^a-z]/gi, "").toLowerCase();
  return normalized === "askuserquestion" || normalized.endsWith("askuserquestion");
}

export function questionForm(name: string, input: unknown): UserQuestion[] | null {
  if (!isAskUserQuestion(name) || !input || typeof input !== "object") return null;
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions = raw.map(readQuestion).filter((item): item is UserQuestion => item != null);
  return questions.length ? questions : null;
}

export function answeredQuestions(input: unknown, answers: Record<string, string | string[]>): unknown {
  const questions = input && typeof input === "object" ? (input as { questions?: unknown }).questions : undefined;
  return { questions: Array.isArray(questions) ? questions : [], answers };
}

export function permissionView(name: string, input: unknown): { name: string; detail: string } {
  const questions = questionForm(name, input);
  if (questions) {
    return { name: "Question", detail: questions.map((item) => item.question).join(" · ") };
  }
  const label = name.trim() || "tool";
  let detail = "";
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const command = record.command ?? record.cmd ?? record.path ?? record.file_path;
    if (typeof command === "string" && command.trim()) detail = command.trim();
  }
  if (!detail && input != null) {
    try {
      detail = JSON.stringify(input);
    } catch {
      detail = "";
    }
  }
  if (detail.length > 180) detail = `${detail.slice(0, 177)}...`;
  return { name: label, detail };
}

function readQuestion(value: unknown): UserQuestion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const question = typeof record.question === "string" ? record.question.trim() : "";
  if (!question) return null;
  const header = typeof record.header === "string" ? record.header.trim() : "";
  const options = Array.isArray(record.options)
    ? record.options.map(readOption).filter((item): item is QuestionOption => item != null)
    : [];
  return { question, header, multiSelect: record.multiSelect === true, options };
}

function readOption(value: unknown): QuestionOption | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label) return null;
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return { label, description };
}
