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

  it("opens inline code and local links, and leaves web links as links", () => {
    const html = renderToStaticMarkup(
      <MarkdownView
        text={"see `food.md` and [doc](notes/food.md) and [web](https://example.com/a)"}
        theme="dark"
        onLink={() => undefined}
        onOpenPath={() => undefined}
      />,
    );
    expect(html).toContain("food.md");
    expect(html).toContain("<button");
    expect(html).not.toContain('href="notes/food.md"');
    expect(html).toContain('href="https://example.com/a"');
  });
});
