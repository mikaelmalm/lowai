import { describe, expect, it } from "vitest";
import { defaultModel, installedAgent, modelsFor, selectedFrom } from "./agents";

describe("agents", () => {
  it("lists only the models for that agent", () => {
    expect(modelsFor("grok")).toEqual(["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5"]);
    expect(modelsFor("agy")[0]).toBe("gemini-3.8-flash-high");
    expect(modelsFor("agy")).toContain("claude-opus-4-6-thinking");
    expect(modelsFor("claude")[0]).toBe("sonnet");
    expect(defaultModel("agy")).toBe("gemini-3.8-flash-high");
  });

  it("keeps a saved agent that is installed and otherwise picks the first", () => {
    expect(selectedFrom("agy", ["grok", "agy"])).toBe("agy");
    expect(selectedFrom("claude", ["grok", "agy"])).toBe("grok");
    expect(selectedFrom("grok", ["claude"])).toBe("claude");
    expect(selectedFrom("grok", [])).toBe("");
    expect(installedAgent("grok", ["claude"])).toBe("claude");
    expect(installedAgent("agy", ["grok", "agy"])).toBe("agy");
    expect(installedAgent("grok", [])).toBe("");
  });
});
