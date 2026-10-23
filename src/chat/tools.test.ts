import { describe, expect, it } from "vitest";
import { toolDetail, toolPresentation } from "./tools";

describe("toolPresentation", () => {
  const folder = "/work/app";

  it("summarises the built-in tools", () => {
    expect(toolPresentation("read_file", { path: "/work/app/src/main.ts" }, folder)).toEqual({ icon: "📜", text: "src/main.ts" });
    expect(toolPresentation("list_dir", { path: "/work/app" }, folder).icon).toBe("📜");
    expect(toolPresentation("grep", { pattern: "session/load" }, folder)).toEqual({ icon: "🔍", text: "session/load" });
    expect(toolPresentation("search_replace", { path: "/work/app/a.ts" }, folder).icon).toBe("🖊️");
    expect(toolPresentation("write", { file_path: "/work/app/b.ts" }, folder).text).toBe("b.ts");
  });

  it("uses a wrench for an unknown tool", () => {
    expect(toolPresentation("run_terminal_command", { command: "echo pwned" }, folder)).toEqual({
      icon: "🔧",
      text: "echo pwned",
    });
  });
});

describe("toolDetail", () => {
  it("keeps three short lines inline", () => {
    expect(toolDetail("one\ntwo\nthree")).toEqual({ long: false, markdown: false, preview: "one" });
  });

  it("folds a fourth line", () => {
    expect(toolDetail("one\ntwo\nthree\nfour").long).toBe(true);
  });

  it("folds a single line past 500 characters", () => {
    expect(toolDetail("a".repeat(500)).long).toBe(false);
    expect(toolDetail("a".repeat(501)).long).toBe(true);
  });

  it("trims the summary to the first line", () => {
    const detail = toolDetail(`${"b".repeat(200)}\nrest`);
    expect(detail.preview).toBe(`${"b".repeat(120)}…`);
  });

  it("treats headings, fences, lists, links, and emphasis as markdown", () => {
    expect(toolDetail("# Title").markdown).toBe(true);
    expect(toolDetail("```\ncode\n```").markdown).toBe(true);
    expect(toolDetail("- one\n- two").markdown).toBe(true);
    expect(toolDetail("see [doc](notes/food.md)").markdown).toBe(true);
    expect(toolDetail("a **bold** word").markdown).toBe(true);
  });

  it("leaves paths and commands as plain text", () => {
    expect(toolDetail("src/**/*.ts").markdown).toBe(false);
    expect(toolDetail("echo pwned").markdown).toBe(false);
  });
});
