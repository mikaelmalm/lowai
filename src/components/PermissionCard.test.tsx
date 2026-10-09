import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionCard } from "./PermissionCard";

describe("PermissionCard", () => {
  it("shows the tool name and both buttons", () => {
    const html = renderToStaticMarkup(
      <PermissionCard name="Bash" input={{ command: "ls" }} answered={null} onAnswer={() => undefined} />,
    );
    expect(html).toContain("Bash");
    expect(html).toContain("ls");
    expect(html).toContain("Allow");
    expect(html).toContain("Deny");
  });

  it("renders AskUserQuestion as choices instead of raw JSON", () => {
    const html = renderToStaticMarkup(
      <PermissionCard
        name="AskUserQuestion"
        input={{
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
        }}
        answered={null}
        onAnswer={() => undefined}
      />,
    );
    expect(html).toContain("How should I format the output?");
    expect(html).toContain("Summary");
    expect(html).toContain("Brief overview");
    expect(html).toContain("Continue");
    expect(html).not.toContain('{"questions"');
  });
});
