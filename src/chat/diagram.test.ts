import { describe, expect, it } from "vitest";
import { isMermaid, keepDrawnSvg } from "./diagram";

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
