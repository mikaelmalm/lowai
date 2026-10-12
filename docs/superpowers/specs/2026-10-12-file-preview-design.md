# File preview — Design

A read-only file column for the session folder. It sits between the chat and the terminal. The person using the window can read code or markdown the agent named, a file from the changed list, or any file they find with Ctrl/Cmd+P.

This is a viewer. It does not edit, diff, or browse a tree.

---

## 1. Decisions

| Topic | Choice |
|---|---|
| Where it sits | Its own column, between the chat and the terminal. Order is sidebar, chat, file column, terminal. |
| Starts | Closed. An existing session does not lose width until the column is opened. |
| Open and close | A Files button in the chat header, immediately before Terminal. Pressed while the column is open. |
| What a session remembers while the app runs | Whether the column is open, and which path it shows. Switching away and back shows the same file. |
| What is saved | `previewWidth` on the session. Default 480. Minimum 240. |
| What is not saved | Open or closed, the path, and the file text. After a restart the column starts closed. |
| Changed list, git repo | Flat `git status` for the session folder: added, modified, deleted, renamed. Read live, not saved. |
| Changed list, no repo | Files this session's agent wrote or edited, derived from saved messages. Reads stay off the list. |
| Opening a changed row | Added, modified, and renamed show the file as it is now. Deleted says the file was deleted. |
| Other ways to open | A tool-row path, inline code, a local markdown link, and Ctrl/Cmd+P. |
| Ctrl/Cmd+P | Same modifier as the sidebar. Opens the column and a name filter. |
| Outside the session folder | Does not open. |
| Body | Read-only. Markdown uses the chat markdown view. Other text is code. |
| Binary | A note that the file cannot be previewed. |
| Large file | The first 512 KiB, then a note that the rest was not loaded. |
| Editing, diff, tree | Out of this spec. |

---

## 2. Goals and non-goals

**Goals**

- Read a file in the session folder without leaving lowai.
- Keep that column open beside the terminal.
- See a flat list of git changes, or, when the folder is not a repo, the files this session edited.
- Open a file the agent named, from a tool row or from inline code or a local link in the message.
- Find any file in the folder with Ctrl/Cmd+P.
- Give each session its own column while the app is running.

**Non-goals**

- A file tree, a persistent explorer, or scanning ordinary sentence text for paths.
- Editing, saving, or a diff view.
- Remembering the open path or the open column across a restart.
- Showing agent reads in the changed list.
- Mixing the agent-edited list into a git repo's status list.
- Previewing a directory.

---

## 3. The column

`App` lays the active session out as chat, file column, terminal. A sash between two visible neighbors sets the width of the column on the right of that sash. The chat keeps at least 320 CSS pixels. The file column and the terminal each keep at least 240 when the window has room. The sidebar clamp counts the file column's width while that column is open, the same way it already counts the terminal.

The column is absent until that session opens it during this run. The Files button toggles it. Closing it keeps the path in memory, so opening it again shows the same file.

The top of the column is the changed-files list. The rest is the open file. Before any file is chosen, the body says to press Ctrl+P, or ⌘P on macOS, to open a file.

`previewWidth` is a number on the session, saved with the app state. A missing or invalid value loads as 480. Older saves gain 480. Dragging the sash saves through the same path as the terminal width.

Open or closed, and the path, live in memory next to the terminal pane state. They are not written to disk.

---

## 4. Opening a file

One open action. If the column is closed, the action opens it. The path has to be a file inside the session folder after `..` is resolved and symlinks are canonicalized. A symlink whose target leaves the folder does not open. A directory does not open.

These fire the action:

- A tool row whose path is inside the folder. A row that shows a search pattern stays plain text.
- Inline code in an agent message, on click, when that text resolves to a file inside the folder.
- A markdown link whose target is a local path, not an `http` or `https` URL, when that path resolves to a file inside the folder.
- A row in the changed list. Deleted rows open the deleted note.
- Ctrl/Cmd+P. The modifier matches the sidebar shortcut: ⌘ on macOS, Ctrl elsewhere. The shortcut is ignored while the terminal pane is focused. It is handled from the composer and the rest of the window, and it calls `preventDefault` only when it opens the filter.

Ctrl/Cmd+P opens the name filter over the window. The filter lists files from `list_files`. Typing keeps rows whose path contains the query, case-insensitive. Up and down move the highlight. Enter opens the highlighted file and closes the filter. Escape closes the filter and leaves the column as it is. Enter with no match does nothing.

A click on inline code or a local link that does not resolve to a file inside the folder does nothing, and it does not open the column. A path inside the folder that is missing opens the column and shows the deleted note.

---

## 5. The changed list

The list refreshes on the same two-second cycle as the branch name, and immediately when the column becomes visible for the active session. A hidden session is not polled.

**Git repo.** `git status` succeeds. Each row is one path and one label:

| Status | Label |
|---|---|
| Untracked, added, or copied | added |
| Modified, or any other change whose path is still in the tree | modified |
| Deleted | deleted |
| Renamed | renamed, on the new path |

The old path of a rename is not a second row. Staged and unstaged changes share those labels. An empty status is an empty list, with the line "No changes." Agent edits are not added on top of git status.

**Not a repo.** `git status` fails, including when `git` is missing. The list is derived from this session's messages. A `write`, `search_replace`, or `edit` tool call contributes its path when that path is inside the session folder. `read_file` and other reads do not. The same path edited twice is one row. The most recently edited path is first. The label is edited. The list updates when the session's messages change. It is still available after a restart because the messages are saved, even though the column starts closed. When this list is also empty, the column says "No git repo."

---

## 6. The body

The body is read-only.

| File | What the body shows |
|---|---|
| Markdown (`.md`) | The existing markdown view, including its theme. |
| Other text | Code, highlighted with highlight.js from the file extension. An unknown extension is plain text. |
| Deleted or missing | The file was deleted. |
| Binary, a null byte in the first 512 KiB | This file cannot be previewed. |
| Larger than 512 KiB | The start of the file, then a note that the rest was not loaded. |
| Read error | The error text. |

While the column is open on a file, the body reloads when the file's modification time changes. An unchanged file does not replace the text, and the scroll position stays. A reload of a changed file keeps the scroll offset.

---

## 7. Commands

All three commands take the session folder. Paths are expanded the same way as the session working directory. Each command refuses a folder path that is not a directory.

| Command | Behavior |
|---|---|
| `git_changes { cwd }` | `git status --porcelain -z` with that folder as the working directory. Returns the labeled rows. A non-zero exit returns no rows and `repo: false`. |
| `list_files { cwd }` | In a repo, tracked files plus untracked files git does not ignore. Otherwise a walk of the folder that skips `.git` and `node_modules`. Paths are relative to the folder. |
| `read_preview { cwd, path }` | Reads one file inside the folder. Returns markdown, text, binary, missing, outside, directory, or truncated text. |

`read_preview` resolves the path against the folder, canonicalizes it, and requires the result to stay inside the canonical folder. A path that fails that check returns outside and no bytes. Markdown is decided by the `.md` extension. A null byte within the first 512 KiB returns binary and no text. A larger file returns the first 512 KiB and truncated. A missing path returns missing.

The commands are registered in `src-tauri/build.rs` and allowed in `src-tauri/capabilities/default.json`.

The pure parsing and confinement live in `crates/core`. The webview rules for the shortcut, the width clamp, which tool rows open, which inline code opens, and which messages count as edits live in `src/preview/rules.ts`.

---

## 8. Error handling

A path outside the folder never reaches the reader as file bytes. The open action ignores it.

`git_changes` failure uses the agent-edited list. It does not show a stack trace. `list_files` falls back to the folder walk when git fails. `read_preview` for a missing file is the deleted note. Any other read failure shows its message in the body.

Repeating a command is safe. A poll that returns after the session changed, or after the column closed, is discarded.

---

## 9. Testing

**Rust**

- Porcelain rows become added, modified, deleted, and renamed, with a rename keeping only the new path.
- A path that escapes the folder with `..` or a symlink is outside and returns no bytes.
- A null byte is binary. A file past 512 KiB is truncated to the first 512 KiB.
- A missing file is missing. A directory is a directory.
- A folder that is not a repo yields `repo: false`.

**Webview**

- The width clamp keeps the chat at 320 and the column at 240 when the window allows it.
- Ctrl/Cmd+P matches the sidebar modifier and is ignored while the terminal is focused.
- A tool row opens only when its path is inside the folder.
- Inline code and a local link open only when they resolve inside the folder. A web link does not.
- `write`, `search_replace`, and `edit` contribute one row per path, newest first. A read does not.
- The header button is pressed while the column is open.
- The column renders the list, a markdown body, a code body, the deleted note, the binary note, and the truncated note.

---

## 10. Out of scope reminder

A later spec can add a diff or a tree. This one ends when each session can open a read-only file column, list git changes or the agent's edits, and preview a file from that list, from the chat, or from Ctrl/Cmd+P.
