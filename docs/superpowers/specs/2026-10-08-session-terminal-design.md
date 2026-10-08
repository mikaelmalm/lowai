# Session terminal — Design

A terminal pane for the Linux app. Each chat session can grow one shell, in that session’s folder, for the person using the window. The shell is a real PTY. Grok never reads or writes it.

This spec is the terminal slice of `docs/features.md`. Windows, Mac, Gemini, and Claude stay out of this build.

---

## 1. Decisions

| Topic | Choice |
|---|---|
| Platform | Linux. The same Rust interface can grow a Windows or Mac PTY later. This build does not. |
| Who types | The person at the keyboard. One shell per chat session. |
| Process | `portable-pty` in the Tauri process. Not `tauri-plugin-pty`. Not a GTK widget. |
| Drawing | xterm.js (`@xterm/xterm`) plus FitAddon. Scrollback lives in that xterm instance. |
| Where it sits | A column to the right of the chat. A sash sets the width. |
| When it starts | The first time that session’s pane is opened. |
| Hide | Hiding the pane, or viewing another session, leaves the process running. |
| Kill | The pane’s kill control, closing the session, or quitting the app ends the process. |
| Open again | If the shell is already alive, opening shows it and focuses it. No second process. |
| Shortcut | A Terminal button in the chat header, and `` Ctrl+` ``. Both open and focus. They do not hide. |
| Width | One width for the app, saved across restarts. Default 480 CSS pixels. |
| Pane open or closed | Remembered per session until the app quits. After a restart every pane starts closed, and no shell is running. |
| Shell program | `$SHELL`, or `/bin/bash` when `SHELL` is unset. No extra arguments. `TERM=xterm-256color`. Working directory is `session.folder`. |
| Agent tools | Unchanged. Grok still cannot run a shell. |

---

## 2. Goals and non-goals

**Goals**

- Open a shell beside the active session’s chat, in that session’s folder.
- Type commands and see the output, including color and cursor control.
- Resize the pane. The shell learns the new column and row count.
- Scroll inside the pane.
- Leave a command running while the pane is hidden or another session is on screen, then come back to the same screen.
- Start a new shell after the old one exits, or after the user kills it.

**Non-goals**

- More than one shell per session, a split inside the pane, or a shell profile picker.
- The agent typing into the PTY, or the PTY’s output entering the chat.
- Restoring a live shell, or its scrollback, after the app quits or the webview reloads.
- Windows, Mac, Gemini, and Claude.
- Search, clickable links, or a WebGL renderer inside the terminal.

---

## 3. Architecture

`App` lays the active chat and the terminal column in a row. The column is absent until that session’s pane has been opened during this run. A drag handle between them changes the column width. The chat’s minimum width is 320 CSS pixels. The terminal’s minimum width is 240. The saved width is clamped into what remains.

The Grok child and the shell do not share input, output, or lifetime. `src-tauri/src/pty.rs` owns the shells. The Grok host stays in `crates/core`.

Each session that has been opened keeps its xterm instance mounted for the rest of the run. While that session is not both active and open, the instance is hidden, not destroyed. Scrollback survives a session switch. It does not survive a webview reload.

---

## 4. Components

**`src-tauri/src/pty.rs`**

Holds the map from session id to live PTY. It spawns, writes, resizes, and closes. It does not know about chat or Grok.

**Tauri commands**

| Command | Behavior |
|---|---|
| `open_terminal { sessionId, cwd }` | Spawns if needed. Each call adds an output channel. A live shell is not spawned again. |
| `write_terminal { sessionId, data }` | Writes bytes to that shell. |
| `resize_terminal { sessionId, cols, rows }` | Sets the PTY size. `cols` and `rows` are at least 1. |
| `close_terminal { sessionId }` | Closes the PTY and removes the map entry. A missing entry is success. |

`close_session` calls `close_terminal` for that id. App exit closes every entry.

The four commands are registered in `src-tauri/build.rs` and allowed in `src-tauri/capabilities/default.json`.

**`TerminalPane`**

One xterm per opened session. It fits on show and on sash move, sends keystrokes as bytes, and writes channel bytes into that session’s xterm only. The chat composer never sees those keystrokes.

**Pane chrome**

Hide closes the column and leaves the process. Kill calls `close_terminal` and closes the column. After a kill or an exit, the next open spawns a new shell and a new xterm.

**Saved state**

`terminalWidth` is a number on the saved app state. Missing or invalid values fall back to 480. Open and closed is not written to disk.

---

## 5. Data flow

1. The user opens the pane with the button or `` Ctrl+` ``.
2. The webview calls `open_terminal` with the session id and `session.folder`.
3. Rust spawns the shell on a new PTY when the map has no live entry. The environment is the app’s environment plus `TERM=xterm-256color`. The working directory is the folder argument.
4. The command returns a Tauri channel of raw bytes. The reader sends each chunk to every channel still open for that session. A channel that closes is removed. Overlapping opens wait on the same spawn, and each caller gets its own channel.
5. The pane fits, sends `resize_terminal`, and focuses the terminal.
6. The pane keeps one channel per session. Before it opens another, it drops the previous channel. xterm keystrokes call `write_terminal`. Channel chunks call `xterm.write` with those bytes, not with a UTF-8 string.
7. A sash move or a newly visible pane sends `resize_terminal` with the fitted size.
8. Hide or a session switch stops write and resize for the hidden pane. The process and the channel stay.
9. When the shell exits, Rust emits `pty-exit` with `{ sessionId, code }` (`code` is an integer, or null when there is no status) and then closes the channel. The map entry is already gone. The pane prints that the shell exited and the code.
10. Kill, session close, and app exit call `close_terminal`. The pane unmounts that session’s xterm on session close.
11. When the pane is already showing an exited shell, the button and `` Ctrl+` `` call `open_terminal` again and replace that xterm with a new one.

Switching back to a session whose pane is still marked open shows the hidden xterm and resizes it. It calls `open_terminal` only when the shell is not already alive.

---

## 6. Error handling

A failed spawn leaves the map unchanged. The pane stays visible and shows the error text: unset shell and no `/bin/bash`, folder missing or not a directory, or the PTY could not be allocated. Keystrokes are not sent. Retry calls `open_terminal` again.

`open_terminal` and `close_terminal` are safe to repeat. A second open during a spawn joins the first. `write_terminal` and `resize_terminal` for a session with no live shell return an error. The pane ignores that error.

Bytes are not decoded as UTF-8 on the way across. A character split across two reads still reaches xterm intact.

On webview reload the shell keeps running. The new pane calls `open_terminal`, receives the live channel, and shows only output from that moment on. Output from the gap is dropped. Previous scrollback is gone.

---

## 7. Testing

**Rust**

Use a stand-in shell, not an interactive `$SHELL`.

- Spawn in a temporary directory, write a command, and read the echoed output.
- A second open returns the same live shell and does not create another process.
- Close ends the process. A second close succeeds. A write after close fails.
- A shell that exits on its own is removed from the map, and the exit reports its code.
- A spawn whose folder does not exist leaves the map empty.

**Webview**

Pure rules, with no real PTY:

- Open with no shell requests a spawn.
- Open with a live shell does not.
- A byte chunk is delivered only to the xterm for that session id.
- Hide leaves the shell marked alive.
- Kill and session close both request `close_terminal`.
- An exit event marks the pane exited. The next open requests a spawn.

**On the Linux window**

Open with `` Ctrl+` ``, run a command, drag the sash, hide the pane while a command is still running, switch sessions, and switch back. The earlier output is still there. Closing the session ends that process.

---

## 8. Out of scope reminder

`docs/features.md` also lists Windows, Mac, Gemini, and Claude. Those are separate specs. This one ends when a Linux session can open, use, hide, and kill its own shell.
