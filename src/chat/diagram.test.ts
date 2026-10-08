import { describe, expect, it } from "vitest";
import { isMermaid } from "./diagram";

describe("isMermaid", () => {
  it("recognizes a mermaid fence", () => {
    expect(isMermaid("language-mermaid")).toBe(true);
    expect(isMermaid("hljs language-mermaid")).toBe(true);
    expect(isMermaid("language-ts")).toBe(false);
    expect(isMermaid(undefined)).toBe(false);
  });
});
