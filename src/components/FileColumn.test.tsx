import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileColumn, type PreviewBody } from "./FileColumn";

const noop = () => undefined;

function column(partial: Partial<Parameters<typeof FileColumn>[0]> = {}) {
  return (
    <FileColumn
      folder="/notes"
      theme="dark"
      platform="Linux"
      rows={[]}
      repo={null}
      file={null}
      path={null}
      palette={false}
      files={[]}
      query=""
      highlight={0}
      onQuery={noop}
      onOpen={noop}
      onPaletteKey={noop}
      {...partial}
    />
  );
}

describe("file column", () => {
  it("shows an edited markdown file", () => {
    const file: PreviewBody = { kind: "markdown", text: "# Soup", truncated: false, error: null, mtimeMs: 1 };
    const html = renderToStaticMarkup(column({ rows: [{ label: "edited", path: "food.md" }], repo: false, file, path: "food.md" }));
    expect(html).toContain("food.md");
    expect(html).toContain("edited");
    expect(html).toContain('aria-label="Hide changes"');
    expect(html).toContain('aria-label="Resize changes"');
    expect(html).toContain("Soup");
  });

  it("shows git status copy and not agent edits when the repo is clean", () => {
    const html = renderToStaticMarkup(column({ repo: true, rows: [] }));
    expect(html).toContain("No changes.");
    expect(html).not.toContain("food.md");
  });

  it("says there is no git repo when the folder is not one", () => {
    expect(renderToStaticMarkup(column({ repo: false, rows: [] }))).toContain("No git repo.");
  });

  it("renders deleted, binary, and truncated files", () => {
    expect(renderToStaticMarkup(column({ path: "gone.md", file: { kind: "missing", text: null, truncated: false, error: null, mtimeMs: null } }))).toContain("The file was deleted.");
    expect(renderToStaticMarkup(column({ path: "a.bin", file: { kind: "binary", text: null, truncated: false, error: null, mtimeMs: 1 } }))).toContain("This file cannot be previewed.");
    const truncated = renderToStaticMarkup(column({ path: "main.ts", file: { kind: "text", text: "let x = 1", truncated: true, error: null, mtimeMs: 1 } }));
    expect(truncated).toContain("hljs-keyword");
    expect(truncated).toContain(">let<");
    expect(truncated).toContain("The rest of this file was not loaded.");
  });

  it("tells you the shortcut before a file is open", () => {
    expect(renderToStaticMarkup(column({ platform: "MacIntel" }))).toContain("Press ⌘P to open a file.");
    expect(renderToStaticMarkup(column({ platform: "Linux" }))).toContain("Press Ctrl+P to open a file.");
  });
});
