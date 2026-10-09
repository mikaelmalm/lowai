import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView mermaid", () => {
  it("keeps a mermaid fence in the diagram shell before a draw lands", () => {
    const html = renderToStaticMarkup(
      <MarkdownView
        text={"```mermaid\nflowchart TD\nA-->B\n```"}
        theme="dark"
        onLink={() => undefined}
      />,
    );
    expect(html).toContain("diagram-block");
    expect(html).not.toContain("code-block");
  });
});
