import { describe, expect, it } from "vitest";
import { answeredQuestions, permissionView, questionForm } from "./permission";

const questions = {
  questions: [
    {
      question: "How should I format the output?",
      header: "Format",
      options: [
        { label: "Summary", description: "Brief overview" },
        { label: "Detailed", description: "Full explanation" },
      ],
    },
  ],
};

describe("questionForm", () => {
  it("reads AskUserQuestion options instead of dumping the JSON", () => {
    const form = questionForm("AskUserQuestion", questions);
    expect(form).toEqual([
      {
        question: "How should I format the output?",
        header: "Format",
        multiSelect: false,
        options: [
          { label: "Summary", description: "Brief overview" },
          { label: "Detailed", description: "Full explanation" },
        ],
      },
    ]);
    expect(questionForm("Bash", { command: "ls" })).toBeNull();
  });

  it("keeps a bash permission as a command line", () => {
    expect(permissionView("Bash", { command: "ls" })).toEqual({ name: "Bash", detail: "ls" });
  });
});

describe("answeredQuestions", () => {
  it("returns the questions with the chosen labels", () => {
    expect(answeredQuestions(questions, { "How should I format the output?": "Summary" })).toEqual({
      questions: questions.questions,
      answers: { "How should I format the output?": "Summary" },
    });
  });
});
