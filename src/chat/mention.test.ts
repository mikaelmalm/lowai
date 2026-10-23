import { describe, expect, it } from "vitest";
import { activeMention, applyMention, mentionChoices, mentionKey, mentionTarget } from "./mention";

describe("activeMention", () => {
  it("reads the token at the caret", () => {
    expect(activeMention("see @src/ma now", 11)).toEqual({ start: 4, query: "src/ma" });
  });

  it("ignores an @ inside a word", () => {
    expect(activeMention("mail me@host.com", 16)).toBeNull();
  });

  it("stops at a space", () => {
    expect(activeMention("@src/main.ts next", 16)).toBeNull();
  });
});

describe("mentionTarget", () => {
  it("keeps a session path on the file list", () => {
    expect(mentionTarget("src/main")).toEqual({ kind: "files", query: "src/main" });
    expect(mentionTarget("")).toEqual({ kind: "files", query: "" });
  });

  it("splits a parent path into a directory and a prefix", () => {
    expect(mentionTarget("../my-file")).toEqual({ kind: "dir", dir: "..", prefix: "my-file" });
    expect(mentionTarget("../")).toEqual({ kind: "dir", dir: "..", prefix: "" });
    expect(mentionTarget("..")).toEqual({ kind: "dir", dir: "..", prefix: "" });
  });

  it("rejects an absolute path", () => {
    expect(mentionTarget("/etc/passwd").kind).toBe("reject");
    expect(mentionTarget("C:/Windows").kind).toBe("reject");
  });
});

describe("mentionChoices", () => {
  const files = ["src/main.ts", "src/menu.ts", "notes/food.md", "a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"];

  it("matches a session fragment and caps the menu", () => {
    expect(mentionChoices({ kind: "files", query: "main" }, files, []).map((row) => row.label)).toEqual(["src/main.ts"]);
    expect(mentionChoices({ kind: "files", query: "" }, files, [])).toHaveLength(8);
  });

  it("keeps parent names that start with the prefix", () => {
    const entries = [
      { name: "my-file.ts", dir: false },
      { name: "My-other", dir: true },
      { name: "readme.md", dir: false },
    ];
    expect(mentionChoices({ kind: "dir", dir: "..", prefix: "my" }, [], entries)).toEqual([
      { label: "../My-other", dir: true },
      { label: "../my-file.ts", dir: false },
    ]);
  });

  it("offers nothing for an absolute path", () => {
    expect(mentionChoices({ kind: "reject" }, files, [{ name: "x", dir: false }])).toEqual([]);
  });
});

describe("applyMention", () => {
  it("replaces a file token and leaves a space", () => {
    expect(applyMention("see @src/ma", 4, 11, "src/main.ts", false)).toEqual({
      text: "see @src/main.ts ",
      cursor: 17,
    });
  });

  it("keeps a single space before the words that follow", () => {
    expect(applyMention("see @src/ma next", 4, 11, "src/main.ts", false).text).toBe("see @src/main.ts next");
  });

  it("inserts a directory with a trailing slash", () => {
    expect(applyMention("@../my", 0, 6, "../notes", true)).toEqual({ text: "@../notes/", cursor: 10 });
  });
});

describe("mentionKey", () => {
  it("moves, accepts, and closes", () => {
    expect(mentionKey("ArrowDown", 0, 2)).toEqual({ type: "move", highlight: 1 });
    expect(mentionKey("ArrowUp", 0, 2)).toEqual({ type: "move", highlight: 0 });
    expect(mentionKey("Enter", 1, 2)).toEqual({ type: "accept" });
    expect(mentionKey("Tab", 1, 2)).toEqual({ type: "accept" });
    expect(mentionKey("Escape", 0, 2)).toEqual({ type: "close" });
    expect(mentionKey("Enter", 0, 0)).toEqual({ type: "none" });
    expect(mentionKey("a", 0, 2)).toEqual({ type: "none" });
  });
});
