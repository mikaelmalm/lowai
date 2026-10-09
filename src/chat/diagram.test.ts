import { describe, expect, it } from "vitest";
import { drawnSvgFor, fitDiagramSvg, heldDiagram, isMermaid, keepDrawnSvg, rememberDrawnSvg } from "./diagram";

describe("isMermaid", () => {
  it("recognizes a mermaid fence", () => {
    expect(isMermaid("language-mermaid")).toBe(true);
    expect(isMermaid("hljs language-mermaid")).toBe(true);
    expect(isMermaid("language-ts")).toBe(false);
    expect(isMermaid(undefined)).toBe(false);
  });
});

describe("keepDrawnSvg", () => {
  it("keeps the last successful diagram when a later draw fails", () => {
    expect(keepDrawnSvg(null, null)).toBeNull();
    expect(keepDrawnSvg(null, "<svg></svg>")).toBe("<svg></svg>");
    expect(keepDrawnSvg("<svg>a</svg>", null)).toBe("<svg>a</svg>");
    expect(keepDrawnSvg("<svg>a</svg>", "<svg>b</svg>")).toBe("<svg>b</svg>");
  });
});

describe("fitDiagramSvg", () => {
  it("drops mermaid's pixel max-width so a wide chart can shrink with the pane", () => {
    const svg = `<svg width="2400" height="800" viewBox="0 0 2400 800" style="max-width: 2400px; background: #1b2128;"><rect width="120" height="40"></rect></svg>`;
    const fitted = fitDiagramSvg(svg);
    expect(fitted).toContain('viewBox="0 0 2400 800"');
    expect(fitted).toContain('<rect width="120" height="40">');
    expect(fitted).not.toMatch(/<svg[^>]*width="2400"/);
    expect(fitted).not.toMatch(/<svg[^>]*height="800"/);
    expect(fitted).not.toMatch(/max-width:\s*2400px/);
  });
});

describe("heldDiagram", () => {
  it("paints a cached svg immediately after a remount of the same source", () => {
    rememberDrawnSvg("flowchart TD\nA-->B", "dark", "<svg>ok</svg>");
    expect(heldDiagram(null, "flowchart TD\nA-->B", "dark")).toBe("<svg>ok</svg>");
    expect(heldDiagram("<svg>old</svg>", "flowchart TD\nC-->D", "dark")).toBe("<svg>old</svg>");
    expect(drawnSvgFor("flowchart TD\nA-->B", "light")).toBeNull();
  });
});

