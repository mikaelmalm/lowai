# Session Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Linux PTY per chat session, drawn with xterm.js in a resizable column to the right of the chat.

**Architecture:** `PtyHost` in the Tauri crate owns the processes. The webview opens, writes, resizes, and closes through commands. Output bytes travel on a Tauri channel per open. xterm.js stays mounted while hidden so scrollback survives a session switch.

**Tech Stack:** Tauri 2, `portable-pty`, React 19, `@xterm/xterm`, `@xterm/addon-fit`, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-10-08-session-terminal-design.md`

## Global Constraints

- Linux only. Do not add Windows, Mac, Gemini, or Claude.
- One shell per session. Grok never reads or writes it.
- Program is `$SHELL`, or `/bin/bash` when `SHELL` is unset or empty. No extra arguments. `TERM=xterm-256color`. Cwd is `session.folder`.
- `open_terminal` does not spawn a second process when one is alive. Each open adds a channel. The reader fans bytes out to every open channel.
- `cols` and `rows` are at least 1.
- Hide and session switch leave the process running. Kill, session close, and app exit end it.
- `` Ctrl+` `` and the Terminal button open and focus. They do not hide.
- Saved width key is `terminalWidth`. Default 480. Minimum pane 240. Minimum chat 320. Missing or invalid width loads as 480. Open or closed is not saved.
- Output is raw bytes. `xterm.write` receives a `Uint8Array`, not a decoded string.
- A failed spawn leaves the map empty of that id and shows the error in the pane.
- After the shell exits, the button and shortcut spawn a new shell and replace that xterm.

## Review Focus

- A chunk that is not valid UTF-8 must still appear (write `Uint8Array`, never `TextDecoder`).
- `SHELL=""` must fall through to `/bin/bash`, not try to spawn an empty path.
- Resize with `cols` or `rows` of 0 must fail and leave the previous size.
- Hiding the pane must not call `close_terminal`.
- Closing the session must kill the shell even if the pane was never opened (no-op close is success).

---

### Task 1: PtyHost

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/Cargo.toml`
- Test: `src-tauri/src/pty.rs` (`cargo test -p ai-shell pty::`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `PtyHost::open(&self, id: &str, cwd: &Path, shell: &Path, on_data: Subscriber, on_exit: ExitHook) -> Result<(), String>`
  - `PtyHost::write(&self, id: &str, data: &[u8]) -> Result<(), String>`
  - `PtyHost::resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String>`
  - `PtyHost::close(&self, id: &str)`
  - `resolve_shell(shell: Option<&str>) -> Result<PathBuf, String>`
  - `Subscriber = Arc<dyn Fn(Vec<u8>) + Send + Sync>`
  - `ExitHook = Arc<dyn Fn(Option<i32>) + Send + Sync>`

- [ ] **Step 1: Write failing tests** for echo, second open fans out, close then write fails, second close, self-exit removes the shell, missing directory, `resolve_shell(None)` and `resolve_shell(Some(""))` prefer `/bin/bash`, resize of 0 fails.

- [ ] **Step 2: Run** `cargo test -p ai-shell pty::` and confirm failure.

- [ ] **Step 3: Implement** `PtyHost` with `portable-pty`. Explicit close sets a flag so the wait thread does not emit exit. Drop kills remaining children.

- [ ] **Step 4: Run** `cargo test -p ai-shell pty::`. Expected: PASS.

- [ ] **Step 5: Commit** the host.

### Task 2: Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs` only if the module path requires it (it does not)
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: Task 1
- Produces commands `open_terminal`, `write_terminal`, `resize_terminal`, `close_terminal`
- `open_terminal(sessionId, cwd, channel: Channel<Vec<u8>>)`
- Event `pty-exit` payload `{ sessionId: string, code: number | null }`
- `close_session` also calls `PtyHost::close`

- [ ] **Step 1: Register the four commands** in `build.rs` and `default.json`.
- [ ] **Step 2: Wire commands.** Shell resolution uses `resolve_shell(std::env::var("SHELL").ok().as_deref())`.
- [ ] **Step 3: `cargo test -p ai-shell`**. Expected: PASS.

### Task 3: Pane rules and saved width

**Files:**
- Create: `src/terminal/rules.ts`
- Create: `src/terminal/rules.test.ts`
- Modify: `src/state/types.ts`
- Modify: `src/state/session-rules.ts`
- Modify: `src/state/session-rules.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_TERMINAL_WIDTH = 480`, `MIN_TERMINAL_WIDTH = 240`, `MIN_CHAT_WIDTH = 320`
  - `clampTerminalWidth(width: number, available: number): number`
  - `openAction(alive: boolean, exited: boolean): "spawn" | "show"`
  - `routeBytes(ownerId: string, sessionId: string, chunk: Uint8Array): Uint8Array | null`
  - `AppState.terminalWidth: number`
  - `hydrate` fills 480 when `terminalWidth` is missing or not a finite number

- [ ] **Step 1: Failing Vitest** for spawn vs show, byte routing, hide does not imply close, exit then spawn, width clamp, hydrate default.
- [ ] **Step 2: Implement until** `pnpm exec vitest run src/terminal/rules.test.ts src/state/session-rules.test.ts` passes.

### Task 4: The pane

**Files:**
- Create: `src/components/TerminalPane.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ChatView.tsx` (Terminal button only)
- Modify: `src/theme/theme.css`
- Modify: `src/useSessions.ts` only if close must notify the pane (prefer Rust `close_session` plus the App close wrapper)
- Modify: `package.json` via pnpm (`@xterm/xterm`, `@xterm/addon-fit`)

**Interfaces:**
- Consumes: Task 2 commands and Task 3 rules
- Pane states live in React state, not in saved `AppState`, except `terminalWidth`

- [ ] **Step 1: Install xterm and render the column.**
- [ ] **Step 2: Open, write, resize, hide, kill, exit, and `` Ctrl+` `` behave as the spec.**
- [ ] **Step 3: `pnpm exec vitest run` and `cargo test -p ai-shell` pass.**
