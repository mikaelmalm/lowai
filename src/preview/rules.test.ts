import { describe, expect, it } from "vitest";
import type { AgentBlock, ChatMessage } from "../state/types";
import {
  clampPreviewWidth,
  editedFiles,
  filterFiles,
  highlightLanguage,
  localPreviewTarget,
  paletteAction,
  previewRows,
  previewShortcut,
  speculativeOpen,
  stillCurrent,
  toolOpenPath,
} from "./rules";

function tool(name: string, input: unknown): AgentBlock {
  return { type: "tool", id: name, name, input, done: true };
}

function agent(blocks: AgentBlock[]): ChatMessage {
  return { id: "a", role: "agent", model: "grok", blocks, done: true, costUsd: null, numTurns: null };
}

const ctrlP = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: "p" };

describe("preview rules", () => {
  it("clamps the column against the chat and the other pane", () => {
    expect(clampPreviewWidth(800, 1200, 480)).toBe(400);
    expect(clampPreviewWidth(480, 1200, 0)).toBe(480);
  });

  it("matches the sidebar modifier and ignores the terminal", () => {
    expect(previewShortcut(ctrlP, false, "ctrl")).toBe(true);
    expect(previewShortcut(ctrlP, true, "ctrl")).toBe(false);
    expect(previewShortcut({ ...ctrlP, ctrlKey: false, metaKey: true }, false, "meta")).toBe(true);
  });

  it("opens tool paths inside the folder and skips search rows", () => {
    expect(toolOpenPath("grep", { pattern: "food", path: "/notes/food.md" }, "/notes")).toBeNull();
    expect(toolOpenPath("write", { file_path: "/notes/food.md" }, "/notes")).toBe("/notes/food.md");
    expect(toolOpenPath("write", { file_path: "/other/food.md" }, "/notes")).toBeNull();
  });

  it("opens local paths and ignores bare words and web links", () => {
    expect(localPreviewTarget("https://example.com")).toBeNull();
    expect(localPreviewTarget("notes/food.md")).toBe("notes/food.md");
    expect(speculativeOpen("missing", "true")).toBe("ignore");
    expect(speculativeOpen("missing", "food.md")).toBe("open");
    expect(speculativeOpen("outside", "food.md")).toBe("ignore");
    expect(speculativeOpen("directory", "notes")).toBe("ignore");
  });

  it("lists agent edits newest first and skips reads", () => {
    const messages = [agent([
      tool("read_file", { path: "/notes/a.md" }),
      tool("write", { file_path: "/notes/food.md" }),
      tool("search_replace", { path: "/notes/food.md" }),
      tool("edit", { path: "/notes/drink.md" }),
    ])];
    expect(editedFiles(messages, "/notes").map((row) => row.path)).toEqual(["drink.md", "food.md"]);
  });

  it("filters files and drops stale reads", () => {
    expect(filterFiles(["Food.md", "drink.md"], "food")).toEqual(["Food.md"]);
    expect(stillCurrent({ sessionId: "a", path: "food.md" }, { sessionId: "b", path: "food.md", visible: true })).toBe(false);
    expect(highlightLanguage("food.md")).toBeNull();
    expect(highlightLanguage("main.rs")).toBe("rust");
    expect(previewRows({ repo: true, rows: [] }, [{ label: "edited", path: "food.md" }])).toEqual([]);
    expect(previewRows(null, [{ label: "edited", path: "food.md" }])).toEqual([]);
    expect(previewRows({ repo: false, rows: [] }, [{ label: "edited", path: "food.md" }])).toEqual([{ label: "edited", path: "food.md" }]);
    expect(paletteAction("ArrowDown", 0, ["a.ts", "b.ts"])).toEqual({ type: "move", highlight: 1 });
    expect(paletteAction("Enter", 0, [])).toEqual({ type: "none" });
    expect(paletteAction("Enter", 0, ["food.md"])).toEqual({ type: "open", path: "food.md" });
    expect(paletteAction("Escape", 0, ["food.md"])).toEqual({ type: "close" });
  });
});
