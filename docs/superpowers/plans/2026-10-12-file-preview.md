# File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only file column between the chat and the terminal so a session can preview a file from git changes, from the agent's edits, or from Ctrl/Cmd+P.

**Architecture:** `crates/core` parses `git status`, confines paths, and classifies file bytes. Three Tauri commands expose that to the webview. Each session stores only `previewWidth` on disk. Whether the column is open, and which path it shows, stay in React memory beside the terminal pane state. The column renders the list and the body. The chat header, tool rows, and markdown clicks all call one open action.

**Tech Stack:** Tauri 2, Rust (`ai-shell-core`), React 19, highlight.js, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-10-12-file-preview-design.md`

## Global Constraints

- The column sits between the chat and the terminal. Order is sidebar, chat, file column, terminal. It starts closed.
- Files button is in the chat header, immediately before Terminal. `aria-label` is `Files`. `aria-pressed` is true while that session's column is open. Title is `Files`.
- Saved field is `previewWidth` on the session. Default 480. Minimum 240. Missing or invalid loads as 480. Open or closed, the path, and the file text are not saved.
- Chat minimum stays 320. A visible file column counts in the sidebar clamp the same way the terminal width does.
- Git list labels are `added`, `modified`, `deleted`, and `renamed`. A rename keeps only the new path. An empty successful status says `No changes.` Agent edits are not merged into a repo list.
- No-repo list label is `edited`, from `write`, `search_replace`, and `edit` only, one row per path, newest first. Empty no-repo list says `No git repo.`
- `read_preview` returns no bytes for a path outside the canonical session folder, including `..` and a symlink that leaves the folder. A directory does not open.
- Body copy is exact: `The file was deleted.` / `This file cannot be previewed.` / `The rest of this file was not loaded.`
- Cap is 512 KiB. A null byte in that prefix is binary and returns no text. Markdown is the `.md` extension only. Other text uses highlight.js from the extension; an unknown extension is plain text.
- Ctrl/Cmd+P uses `sidebarModifier`. It is ignored while focus is inside `.terminal-column`. It opens the column and the filter. Escape closes the filter only. The filter match is a case-insensitive substring.
- Poll interval is 2000 ms, and only while the active session's column is visible. A response for a session or path that is no longer current is discarded.
- No tree, no editor, no diff.

## Review Focus

- A symlink inside the folder whose target is outside must return `outside` and no text. Task 1 pins this.
- Inline code `true` must not open the column. Task 3 pins `speculativeOpen`.
- A clean git repo must show `No changes.` and must ignore agent-edited rows. Task 5 pins this.
- Ctrl/Cmd+P while the terminal is focused must not open the filter. Task 3 pins `previewShortcut`.
- A `read_preview` response that arrives after the session or path changed must not replace the body. Task 3 pins `stillCurrent`, and Task 6 calls it before `setState`.

---

### Task 1: Preview confinement and porcelain parsing

**Files:**
- Create: `crates/core/src/preview.rs`
- Modify: `crates/core/src/lib.rs`
- Test: `crates/core/src/preview.rs` (`mod tests`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `pub fn parse_porcelain(bytes: &[u8]) -> Vec<ChangeRow>`
  - `pub struct ChangeRow { pub label: String, pub path: String }`
  - `pub enum Confined { Inside(std::path::PathBuf), Outside, Missing, Directory }`
  - `pub fn confine(folder: &Path, raw: &str) -> Confined`
  - `pub struct PreviewFile { pub kind: String, pub text: Option<String>, pub truncated: bool, pub error: Option<String>, pub mtime_ms: Option<u64> }` with `#[serde(rename_all = "camelCase")]`
  - `pub fn preview_file(folder: &Path, raw: &str) -> PreviewFile`
  - `pub const PREVIEW_BYTE_CAP: usize = 512 * 1024`

`kind` is `markdown`, `text`, `binary`, `missing`, `outside`, `directory`, or `error`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn porcelain_labels_and_rename_keep_the_new_path() {
    let bytes = b" M src/a.ts\0?? notes/food.md\0D  gone.md\0R  from.ts\0to.ts\0";
    let rows = parse_porcelain(bytes);
    assert_eq!(rows[0], row("modified", "src/a.ts"));
    assert_eq!(rows[1], row("added", "notes/food.md"));
    assert_eq!(rows[2], row("deleted", "gone.md"));
    assert_eq!(rows[3], row("renamed", "to.ts"));
    assert_eq!(rows.len(), 4);
}

#[test]
fn confine_rejects_parent_and_outside_symlink() {
    // temp dir folder/inner/link -> folder's parent
    let confined = confine(&folder, "../outside.txt");
    assert!(matches!(confined, Confined::Outside));
    let linked = confine(&folder, "inner/link");
    assert!(matches!(linked, Confined::Outside));
}

#[test]
fn preview_file_classifies_bytes() {
    // write hello.rs, big file of b'a' * (PREVIEW_BYTE_CAP + 10), file with a 0 byte, a directory, a missing path
    assert_eq!(preview_file(&folder, "hello.rs").kind, "text");
    let big = preview_file(&folder, "big.txt");
    assert_eq!(big.kind, "text");
    assert!(big.truncated);
    assert_eq!(big.text.unwrap().len(), PREVIEW_BYTE_CAP);
    assert_eq!(preview_file(&folder, "bin.dat").kind, "binary");
    assert!(preview_file(&folder, "bin.dat").text.is_none());
    assert_eq!(preview_file(&folder, "subdir").kind, "directory");
    assert_eq!(preview_file(&folder, "missing.md").kind, "missing");
    assert_eq!(preview_file(&folder, "note.md").kind, "markdown");
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p ai-shell-core preview:: -- --test-threads=8`

Expected: FAIL compiling or with unresolved `parse_porcelain`.

- [ ] **Step 3: Implement the parser, `confine`, and `preview_file`**

Porcelain `-z` records are two status bytes, a space, a path, and a NUL. `R` and `C` records have a second NUL-terminated path. Label priority for one record: either byte `R` → `renamed` and the second path; else either byte `D` → `deleted`; else either byte `A`, `C`, or `?` → `added`; else `modified`.

`confine` canonicalizes the folder and the joined path. A target outside the canonical folder is `Outside`. Missing is `Missing`. A directory is `Directory`.

`preview_file` reads only `Inside` files, and at most `PREVIEW_BYTE_CAP` bytes plus one. A null byte in that prefix returns `binary` and `text: None`. A file longer than the cap returns `truncated: true` and the first `PREVIEW_BYTE_CAP` bytes, decoded lossy as UTF-8. `.md` is `markdown`. Anything else text is `text`. `mtime_ms` is the modified time in milliseconds when the file is inside. IO failure is `kind: "error"` and `error: Some(message)`.

Export the types and functions from `lib.rs`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p ai-shell-core preview:: -- --test-threads=8`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/preview.rs crates/core/src/lib.rs
git commit -m "Parse git status and confine preview paths."
```

---

### Task 2: Git changes, file list, and the Tauri commands

**Files:**
- Modify: `crates/core/src/preview.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src-tauri/permissions/autogenerated/git_changes.toml`
- Create: `src-tauri/permissions/autogenerated/list_files.toml`
- Create: `src-tauri/permissions/autogenerated/read_preview.toml`
- Test: `crates/core/src/preview.rs`

**Interfaces:**
- Consumes: `preview_file`, `parse_porcelain`, `ChangeRow` from Task 1
- Produces:
  - `pub struct GitChanges { pub repo: bool, pub rows: Vec<ChangeRow> }`
  - `pub fn git_changes(cwd: &Path) -> GitChanges`
  - `pub fn list_files(cwd: &Path) -> Vec<String>`
  - Tauri commands `git_changes(cwd: String) -> GitChanges`, `list_files(cwd: String) -> Vec<String>`, `read_preview(cwd: String, path: String) -> PreviewFile`
  - `fn session_folder(cwd: &str) -> PathBuf` in `src-tauri/src/lib.rs`, used by `git_branch` and these three commands

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn git_changes_reads_a_repo_and_rejects_a_plain_folder() {
    // git init -b main, write food.md, git add, append a line
    let changes = git_changes(&repo);
    assert!(changes.repo);
    assert!(changes.rows.iter().any(|row| row.path.ends_with("food.md") && row.label == "modified"));
    assert!(!git_changes(&plain).repo);
    assert!(git_changes(&plain).rows.is_empty());
}

#[test]
fn list_files_uses_git_and_skips_node_modules_outside_a_repo() {
    // tracked a.ts, untracked b.ts, gitignored secret.env
    let listed = list_files(&repo);
    assert!(listed.iter().any(|path| path == "a.ts"));
    assert!(listed.iter().any(|path| path == "b.ts"));
    assert!(!listed.iter().any(|path| path.contains("secret.env")));
    // plain/node_modules/x.js and plain/notes/food.md
    let walked = list_files(&plain);
    assert!(walked.iter().any(|path| path == "notes/food.md"));
    assert!(!walked.iter().any(|path| path.contains("node_modules")));
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p ai-shell-core preview::tests::git_changes -- --test-threads=8`

Expected: FAIL with unresolved `git_changes`.

- [ ] **Step 3: Implement the two functions and register the commands**

`git_changes` runs `git status --porcelain -z` with `current_dir(cwd)`. Success parses porcelain and sets `repo: true`, including an empty row list. Any non-zero exit or spawn failure returns `repo: false` and no rows. A cwd that is not a directory does the same.

`list_files` runs `git ls-files -z --cached --others --exclude-standard` when that command exits 0. Otherwise it walks the folder, does not follow directory symlinks, and does not descend into `.git` or `node_modules`. Returned paths are relative and use `/`.

`read_preview` calls `preview_file`. Register `git_changes`, `list_files`, and `read_preview` in `lib.rs` and `build.rs`. Allow `allow-git-changes`, `allow-list-files`, and `allow-read-preview` in `capabilities/default.json`. Write the three permission files in the same shape as `git_branch.toml`.

Extract `session_folder` from the cwd handling in `git_branch` and use it for all four commands.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cargo test -p ai-shell-core preview:: -- --test-threads=8 && cargo check -p lowai`

Expected: tests PASS and `cargo check` exits 0.

- [ ] **Step 5: Commit**

```bash
git add crates/core/src/preview.rs src-tauri/src/lib.rs src-tauri/build.rs src-tauri/capabilities/default.json src-tauri/permissions/autogenerated/git_changes.toml src-tauri/permissions/autogenerated/list_files.toml src-tauri/permissions/autogenerated/read_preview.toml
git commit -m "Expose preview reads and git changes to the window."
```

---

### Task 3: Webview preview rules

**Files:**
- Create: `src/preview/rules.ts`
- Create: `src/preview/rules.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` from `src/state/types.ts`. Tool path keys match `stringField` in `src/chat/tools.ts`: `path`, `file_path`, `target_file`, `file`.
- Produces:
  - `export const DEFAULT_PREVIEW_WIDTH = 480`
  - `export const MIN_PREVIEW_WIDTH = 240`
  - `export function clampPreviewWidth(width: number, available: number, otherPane: number): number`
  - `export function previewShortcut(event, terminalFocused: boolean, modifier: "ctrl" | "meta"): boolean`
  - `export function pathInsideFolder(path: string, folder: string): boolean`
  - `export function toolOpenPath(name: string, input: unknown, folder: string): string | null`
  - `export function localPreviewTarget(href: string): string | null`
  - `export function speculativeOpen(kind: string, text: string): "open" | "ignore"`
  - `export function editedFiles(messages: ChatMessage[], folder: string): { label: "edited"; path: string }[]`
  - `export function filterFiles(paths: string[], query: string): string[]`
  - `export function stillCurrent(request: { sessionId: string; path: string | null }, current: { sessionId: string; path: string | null; visible: boolean }): boolean`
  - `export function highlightLanguage(path: string): string | null`
  - `export function previewRows(changes: { repo: boolean; rows: { label: string; path: string }[] } | null, edited: { label: "edited"; path: string }[]): { label: string; path: string }[]`
  - `export function paletteAction(key: string, highlight: number, results: string[]): { type: "move"; highlight: number } | { type: "open"; path: string } | { type: "close" } | { type: "none" }`

- [ ] **Step 1: Write the failing tests**

```ts
expect(clampPreviewWidth(800, 1200, 480)).toBe(400); // 1200 - 480 - 320
expect(clampPreviewWidth(480, 1200, 0)).toBe(480);
expect(previewShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: "p" }, false, "ctrl")).toBe(true);
expect(previewShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: "p" }, true, "ctrl")).toBe(false);
expect(previewShortcut({ ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, key: "p" }, false, "meta")).toBe(true);

expect(toolOpenPath("grep", { pattern: "food", path: "/notes/food.md" }, "/notes")).toBeNull();
expect(toolOpenPath("write", { file_path: "/notes/food.md" }, "/notes")).toBe("/notes/food.md");
expect(toolOpenPath("write", { file_path: "/other/food.md" }, "/notes")).toBeNull();

expect(localPreviewTarget("https://example.com")).toBeNull();
expect(localPreviewTarget("notes/food.md")).toBe("notes/food.md");
expect(speculativeOpen("missing", "true")).toBe("ignore");
expect(speculativeOpen("missing", "food.md")).toBe("open");
expect(speculativeOpen("outside", "food.md")).toBe("ignore");
expect(speculativeOpen("directory", "notes")).toBe("ignore");

const messages = [agent([tool("read_file", { path: "/notes/a.md" }), tool("write", { file_path: "/notes/food.md" }), tool("search_replace", { path: "/notes/food.md" }), tool("edit", { path: "/notes/drink.md" })])];
expect(editedFiles(messages, "/notes").map((row) => row.path)).toEqual(["drink.md", "food.md"]);

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
```

`clampPreviewWidth(800, 1200, 480)` reserves the chat minimum of 320 and the other pane, so the max is 400.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run src/preview/rules.test.ts`

Expected: FAIL because `src/preview/rules.ts` does not exist.

- [ ] **Step 3: Implement `src/preview/rules.ts`**

`clampPreviewWidth` uses the same shape as `clampTerminalWidth`, with `available - otherPane` as the room. `previewShortcut` matches `sidebarShortcut` with key `p`.

`pathInsideFolder` rejects empty paths and any normalized path whose first segments leave `folder`. Absolute paths must equal `folder` or start with `folder + "/"`.

`toolOpenPath` returns null for `grep`. For every other tool it returns the first string among `path`, `file_path`, `target_file`, and `file` when `pathInsideFolder` is true.

`localPreviewTarget` returns null for empty, `http://`, `https://`, and `mailto:`. Otherwise it returns the href.

`speculativeOpen` returns `ignore` for `outside` and `directory`. It returns `ignore` for `missing` when `text` contains neither `/` nor `.`. Every other kind returns `open`.

`editedFiles` walks agent messages from first to last. For `write`, `search_replace`, and `edit`, when the path is inside `folder`, remove any existing row for that path and insert the relative path at index 0 with label `edited`. A relative path is the path with the folder prefix stripped. Reads are skipped.

`filterFiles` keeps paths whose lowercase form contains the lowercase query. An empty query returns every path.

`stillCurrent` is true only when `visible` is true and `sessionId` and `path` match.

`highlightLanguage` returns `typescript` for `ts` and `tsx`, `javascript` for `js` and `jsx`, `rust` for `rs`, `css` for `css`, `json` for `json`, `python` for `py`, and null otherwise. `.md` is null because markdown uses `MarkdownView`.

`previewRows` returns `[]` when `changes` is null. It returns `changes.rows` when `repo` is true, including an empty list. It returns `edited` only when `repo` is false.

`paletteAction` moves the highlight with `ArrowUp` and `ArrowDown`, clamped to the result list. `Enter` on an empty list is `{ type: "none" }`. `Enter` otherwise opens `results[highlight]`. `Escape` is `{ type: "close" }`. Any other key is `{ type: "none" }`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run src/preview/rules.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/preview/rules.ts src/preview/rules.test.ts
git commit -m "Add the file preview rules."
```

---

### Task 4: Save the preview width

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/session-rules.ts`
- Modify: `src/state/session-rules.test.ts`
- Modify: `src/sidebar/rules.ts`
- Modify: `src/sidebar/rules.test.ts`
- Modify: `src/useSessions.ts`
- Modify: `src/components/shell.test.tsx` (the session fixture needs `previewWidth`)

**Interfaces:**
- Consumes: `DEFAULT_PREVIEW_WIDTH` from Task 3
- Produces:
  - `Session.previewWidth: number`
  - `setPreviewWidth(sessionId: string, width: number)` on the sessions API, same save path as `setTerminalWidth`
  - `clampSidebarWidth(width: number, windowWidth: number, terminalWidth: number, previewWidth: number)`

- [ ] **Step 1: Write the failing tests**

In `session-rules.test.ts`, a session missing `previewWidth` hydrates as 480. A session with `previewWidth: 360` keeps 360. `previewWidth: "wide"` becomes 480.

In `sidebar/rules.test.ts`, `clampSidebarWidth(280, 1400, 480, 480)` stays within `1400 - 320 - 480 - 480`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run src/state/session-rules.test.ts src/sidebar/rules.test.ts`

Expected: FAIL because `previewWidth` is absent.

- [ ] **Step 3: Persist the width and reserve it in the sidebar clamp**

Add `previewWidth` to `Session`. `hydrate` uses `savedWidth(session.previewWidth, DEFAULT_PREVIEW_WIDTH)`. New sessions in `useSessions` set `previewWidth: DEFAULT_PREVIEW_WIDTH`. `setPreviewWidth` maps the session the same way `setTerminalWidth` does.

`clampSidebarWidth` subtracts both pane widths: `windowWidth - 320 - terminal - preview`. Update every existing call to pass `0` for the new argument where the file column is closed, and update the existing tests for the new parameter.

Add `previewWidth: 480` to the fixture in `src/components/shell.test.tsx`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run src/state/session-rules.test.ts src/sidebar/rules.test.ts src/components/shell.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/types.ts src/state/session-rules.ts src/state/session-rules.test.ts src/sidebar/rules.ts src/sidebar/rules.test.ts src/useSessions.ts src/components/shell.test.tsx
git commit -m "Save each session's file column width."
```

---

### Task 5: File column and name filter

**Files:**
- Modify: `src/components/icons.tsx` (`FileIcon` export)
- Create: `src/components/FileColumn.tsx`
- Create: `src/components/FileColumn.test.tsx`
- Modify: `src/theme/theme.css`
- Modify: `src/components/ChatView.tsx`
- Modify: `src/components/shell.test.tsx`

**Interfaces:**
- Consumes: `highlightLanguage`, `filterFiles`, `previewRows` from Task 3. `MarkdownView`. `PreviewFile` fields from Task 1: `kind`, `text`, `truncated`, `error`.
- Produces:
  - `export function FileIcon()`
  - `export function FileColumn(props: { folder: string; theme: Theme; platform: string; rows: { label: string; path: string }[]; repo: boolean | null; file: PreviewFile | null; path: string | null; palette: boolean; files: string[]; query: string; highlight: number; onQuery: (query: string) => void; onOpen: (path: string) => void; onPaletteKey: (key: string) => void })`
  - `ChatView` props `filesOpen: boolean` and `onFiles: () => void`

`repo: null` means the first `git_changes` call has not returned. `file: null` means no path is selected.

- [ ] **Step 1: Write the failing tests**

```tsx
const html = renderToStaticMarkup(
  <FileColumn folder="/notes" theme="dark" platform="Linux" rows={[{ label: "edited", path: "food.md" }]} repo={false} file={{ kind: "markdown", text: "# Soup", truncated: false, error: null, mtimeMs: 1 }} path="food.md" palette={false} files={[]} query="" highlight={0} onQuery={() => undefined} onOpen={() => undefined} onPaletteKey={() => undefined} />,
);
expect(html).toContain("food.md");
expect(html).toContain("edited");
expect(html).toContain("Soup");

expect(renderToStaticMarkup(column({ repo: true, rows: [], file: null }))).toContain("No changes.");
expect(renderToStaticMarkup(column({ repo: true, rows: [], editedWouldBe: "food.md" }))).not.toContain("food.md");
expect(renderToStaticMarkup(column({ repo: false, rows: [] }))).toContain("No git repo.");
expect(renderToStaticMarkup(column({ file: { kind: "missing" } }))).toContain("The file was deleted.");
expect(renderToStaticMarkup(column({ file: { kind: "binary" } }))).toContain("This file cannot be previewed.");
expect(renderToStaticMarkup(column({ file: { kind: "text", text: "let x = 1", truncated: true } }))).toContain("The rest of this file was not loaded.");
expect(renderToStaticMarkup(column({ path: null, platform: "MacIntel" }))).toContain("Press ⌘P to open a file.");
expect(renderToStaticMarkup(column({ path: null, platform: "Linux" }))).toContain("Press Ctrl+P to open a file.");
```

The `column` helper fills the unused props. The clean-repo case passes `rows: []` even though the caller might also have edited files; `FileColumn` renders `rows` only, so Task 6 must pass `previewRows(...)` rather than the raw edited list.

In `shell.test.tsx`, render `ChatView` with `filesOpen` true and expect `aria-pressed="true"` on the button named Files, and expect that button's markup to appear before the Terminal button.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec vitest run src/components/FileColumn.test.tsx src/components/shell.test.tsx`

Expected: FAIL because `FileColumn` and the Files button do not exist.

- [ ] **Step 3: Implement the column, the icon, and the header button**

`FileIcon` is a 16×16 stroke icon using the same `pen` as `TerminalIcon`: a document outline with a folded corner.

`FileColumn` is a `aside` with class `file-column`. The list is buttons. Each button shows the path and the label. `onOpen(path)` fires on click. The empty copy is `No changes.` when `repo` is true, `No git repo.` when `repo` is false, and nothing when `repo` is null.

The body renders `MarkdownView` for `kind: "markdown"` with `onLink` that no-ops. Text uses `highlight.js` `highlight` when `highlightLanguage(path)` returns a name, and a plain `<pre>` otherwise. Truncation adds a paragraph `The rest of this file was not loaded.` Missing renders `The file was deleted.` Binary renders `This file cannot be previewed.` `error` renders `file.error`. No path renders the Ctrl/⌘ line from `sidebarModifier(platform)`.

When `palette` is true, render an input and the `filterFiles(files, query)` results. The input calls `onQuery`. Keydown on the input calls `onPaletteKey` with `event.key` and prevents default for `ArrowUp`, `ArrowDown`, `Enter`, and `Escape`. Mark the row at `highlight` with `aria-selected="true"`.

Add `filesOpen` and `onFiles` to `ChatView`. The Files button sits immediately before the Terminal button.

CSS: `.file-column` is a fixed-width flex child with the same border and background tokens as `.terminal-column`. The list scrolls independently of the body. The palette is a panel at the top of the window, centered, using `--surface`, `--line`, and `--ink`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run src/components/FileColumn.test.tsx src/components/shell.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/icons.tsx src/components/FileColumn.tsx src/components/FileColumn.test.tsx src/components/ChatView.tsx src/components/shell.test.tsx src/theme/theme.css
git commit -m "Add the read-only file column."
```

---

### Task 6: Open files from the chat and keep each session's column

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ChatView.tsx`
- Modify: `src/components/AgentCard.tsx`
- Modify: `src/components/ToolCallRow.tsx`
- Modify: `src/components/ToolRun.tsx`
- Modify: `src/components/MarkdownView.tsx`
- Modify: `src/sidebar/rules.ts` only if Task 4's call sites in `App.tsx` still pass three arguments
- Test: `src/components/ToolCallRow` behavior through `src/components/FileColumn.test.tsx` is not repeated. Add cases to `src/preview/rules.test.ts` only if Task 3 missed a case. Add `src/components/markdown.test.tsx` cases for the code and link callbacks.

**Interfaces:**
- Consumes: every production export from Tasks 2 through 5, plus `invoke` from `@tauri-apps/api/core`.
- Produces: the running column. In-memory `previews: Record<string, { visible: boolean; path: string | null }>`. No new saved fields.

- [ ] **Step 1: Write the failing markdown markup test**

In `src/components/markdown.test.tsx`:

```tsx
const html = renderToStaticMarkup(
  <MarkdownView text={"see `food.md` and [doc](notes/food.md) and [web](https://example.com/a)"} theme="dark" onLink={() => undefined} onOpenPath={() => undefined} />,
);
expect(html).toContain("food.md");
expect(html).toContain("<button");
expect(html).not.toContain('href="notes/food.md"');
expect(html).toContain('href="https://example.com/a"');
```

`onOpenPath` is optional. Existing `MarkdownView` calls omit it, and those tests stay as they are.

- [ ] **Step 2: Run the existing preview tests**

Run: `pnpm exec vitest run src/preview/rules.test.ts src/components/shell.test.tsx src/components/FileColumn.test.tsx`

Expected: PASS. This step guards the wiring from changing those contracts.

- [ ] **Step 3: Wire the column**

In `App`, keep `previews` in `useState`. The Files button toggles `visible` for the active session and leaves `path` untouched. `openPreview(sessionId, path)` sets `visible: true` and `path`.

Pass `filesOpen={Boolean(previews[session.id]?.visible)}` and `onFiles` into `ChatView`.

Render `FileColumn` after the chat column and before the terminal, only when that session's preview is visible. Clamp the file column first: `clampPreviewWidth(session.previewWidth, splitWidth, terminalVisible ? savedTerminalWidth : 0)`. Then clamp the terminal with `clampTerminalWidth(savedTerminalWidth, splitWidth - visiblePreviewWidth)`. Pass both visible widths into `clampSidebarWidth`. Put a sash on the file column's left edge that drags `setPreviewWidth`. The terminal keeps the sash it already has.

Poll `git_changes` every 2000 ms while the active column is visible, and once immediately when it opens. When `repo` is false, rows are `editedFiles(session.messages, session.folder)`. When `repo` is true, rows are the command rows. Pass that result through `previewRows`.

When `path` is set, call `read_preview`. Before storing the result, require `stillCurrent`. If `mtimeMs` equals the stored mtime, do not replace `text`. On change, replace the body and restore `scrollTop` in a layout effect. Deleted list rows call `openPreview` with that path; `kind: "missing"` renders the deleted copy.

`list_files` runs when the palette opens. Ctrl/Cmd+P is a `window` keydown beside the sidebar shortcut: `previewShortcut`, then `preventDefault`, then show the palette and the column. While the palette is open, `paletteAction` handles `ArrowUp`, `ArrowDown`, `Enter`, and `Escape`, including when the input is focused. `open` calls `openPreview` and closes the palette. `close` closes the palette and leaves the column. `none` does not open a path. `move` sets the highlight.

`ToolCallRow` accepts an optional `onOpen`. When `toolOpenPath` returns a path, the row is a `<button>` and the click calls `onOpen(path)`. `ToolRun` and `AgentCard` pass `onOpen` down. `ChatView` passes `(path) => onOpenFile(path)`.

`MarkdownView` gains `onOpenPath?: (path: string) => void`. Inline `code` without a `className` clicks `onOpenPath(text)` when the prop is set. A link whose `localPreviewTarget` is non-null calls `onOpenPath` instead of `onLink`. `App`'s handler calls `read_preview` and uses `speculativeOpen`. `ignore` leaves `previews` unchanged. `open` calls `openPreview`.

Discard a poll or read when `stillCurrent` is false.

- [ ] **Step 4: Run the tests and the Rust suite**

Run: `pnpm exec vitest run src/preview src/components/shell.test.tsx src/components/FileColumn.test.tsx src/components/markdown.test.tsx src/state/session-rules.test.ts src/sidebar/rules.test.ts && cargo test -p ai-shell-core preview:: -- --test-threads=8`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/ChatView.tsx src/components/AgentCard.tsx src/components/ToolCallRow.tsx src/components/ToolRun.tsx src/components/MarkdownView.tsx src/components/markdown.test.tsx
git commit -m "Open preview files from the chat and the shortcut."
```
