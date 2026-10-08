import { describe, expect, it } from "vitest";
import { toolPresentation } from "./tools";

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
