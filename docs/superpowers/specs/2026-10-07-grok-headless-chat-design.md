# Grok Headless Chat — Design

A desktop app that runs several headless Grok sessions side by side. Each session works in its own folder, sessions are grouped into named projects, and the transcript and the Grok conversation both survive a restart. The UI, persistence, and notification behavior follow `PROJECT-SPEC.md` (the Claude app). The agent protocol does not: Grok has no long-lived stdin stream, so each session is one warm `grok agent stdio` process speaking ACP.

Gemini is a later backend behind the same Rust trait. This spec does not implement it.

Grok CLI on the machine where this was written: **1.0.46**. Flag placement below was checked with `--help` (exit 0). Event names and a live tool denial are confirmed by the probe in section 12 before implementation treats them as frozen.

---

## 1. Decisions

| Topic | Choice |
|---|---|
| First agent | Grok. Gemini is a second `AgentBackend` later. |
| Process model | One `grok agent --no-leader stdio` process per session. |
| Platforms | macOS, and Linux under WSL via WSLg. One Tauri app. |
| Tools | Read, list, search, and edit are allowed. Shell, web, and MCP are denied. No in-app permission prompt. |
| Window | Tauri webview. Sounds play in the webview. OS notifications are best-effort; the unread dot is the reliable signal. |
| Conversation id | The frontend owns the permanent session id. Grok's id is stored separately as `agentSessionId`. |

---

## 2. Goals and non-goals

**Goals**

- Run about three sessions in parallel, each in its own working directory, and tell them apart at a glance.
- Stream replies live, with tool calls visible in the order the agent produced them.
- Keep projects, transcripts, and the Grok conversation across restarts, and resume on the next message.
- Notice when an agent finishes and is waiting, including when another session is on screen.
- Allow read, list, search, and edit. Deny shell, web, and MCP even when the user's own Grok config would allow them.
- Run on macOS and in WSL (WSLg).

**Non-goals**

- A Gemini backend in this build. The trait is the extension point.
- In-app permission prompts, re-authentication, sync, export, or archiving closed sessions.
- A Windows-native shell that calls `wsl grok`. The app runs inside WSL.
- Client-side filesystem or terminal ACP capabilities. Grok uses its own tools.
- Plan mode, subagents, worktrees, and the Grok leader process.

---

## 3. Stack

Same stack as `PROJECT-SPEC.md` section 2: Tauri v2, Rust (tokio, serde_json, uuid), React + TypeScript + Vite, `react-markdown` with `remark-gfm` and `rehype-highlight`, Tauri plugins `opener`, `dialog`, and `notification`, Vitest, and `cargo test`. No state library, router, CSS framework, or database. pnpm.

There is no `play_sound` command. The webview plays the two UI sounds.

---

## 4. Architecture

```
React (sessions, projects, cards)
    │  invoke + one "agent-event" channel
    ▼
Rust commands (all async)
    AgentBackend
      └─ GrokAcp
           one `grok … agent --no-leader stdio` per session
           JSON-RPC over stdin/stdout
           permission requests answered in Rust
```

- **One process per session.** `--no-leader` so closing one session does not kill the others, and so tools stay in that process.
- **One event channel.** Rust stamps `_session_id` (the frontend id) on every normalized event and emits `agent-event`.
- **Frontend-owned ids.** `crypto.randomUUID()` is the session id for the sidebar, the transcript, and the process map. `agentSessionId` is Grok's id from `session/new`.
- **Lazy resume.** After a restart no processes are running. The first message spawns Grok and calls `session/load`.
- **Normalized events.** React never sees ACP. The reducer only understands the events in section 5.

---

## 5. Components

### Frontend

Same layout as the Claude app: `App`, `Sidebar` (project switcher, session list), `useSessions`, chat cards, turtle roster, CSS-variable theme.

`useSessions` owns state, the single event listener, start and resume, saving, and notifications. Refs mirror state for that listener. No side effects inside `setState` updaters. The listener is registered once.

Normalized events:

| Event | Effect |
|---|---|
| `text_delta` | Append to the open text block |
| `tool_start` | Open a tool block (name + input) |
| `tool_done` | Mark that tool block finished |
| `turn_done` | Close the card, show cost when present, maybe notify |
| `process_exited` | "Session ended" card, with stderr |
| `resume_failed` | Keep the transcript, clear `agentSessionId` |

Thought chunks are dropped. The reducer keeps unchanged block objects identical so a memoized block re-renders only while it streams.

Tool rows:

| Tools | Icon | Argument shown |
|---|---|---|
| `read_file`, `list_dir` | scroll | path, relative to the session folder |
| `grep` | search | pattern |
| `search_replace`, `write` | pen | path |
| anything else | wrench | first string value |

Names are confirmed by the probe. Unknown names use the wrench row.

### Rust

| Unit | Responsibility |
|---|---|
| `AgentBackend` | `start`, `send`, `set_model`, `close`. Commands call only this. |
| `GrokAcp` | The child, the JSON-RPC reader/writer, permission answers, normalization. |
| `platform` | State-file path, login-shell PATH, opening links. The only macOS / Linux branch. |
| `persist` | Atomic `state.json`, quarantine, refuse to save after a failed read. |

Commands, all `async`:

| Command | Purpose |
|---|---|
| `start_session(session_id, cwd, model, agent_session_id?)` | Spawn Grok. Refuse an id that is already running. Distinct errors for a missing folder and a missing binary. |
| `send_message(session_id, text)` | `session/prompt` for that session. |
| `set_model(session_id, model)` | `session/set_config_option` while running. Stored and applied on the next start when asleep. |
| `close_session(session_id)` | Drop it from the map and kill the child. |
| `load_app_state` / `save_app_state` / `quarantine_app_state` | The state file. `Ok(None)` when it is missing. |

`nav_guard` allows `tauri://localhost` and, in dev only, `http://localhost`.

### What a Gemini backend will implement later

The same four methods, emitting the same normalized events. No UI change.

---

## 6. Grok process and protocol

### Spawn

```
grok \
  --no-subagents \
  --disable-web-search \
  --permission-mode dontAsk \
  --allow Read --allow Edit --allow Write --allow Grep \
  --deny Bash --deny WebFetch --deny WebSearch --deny MCPTool \
  agent --no-leader --model <model-id> stdio
```

Working directory is the session folder (`current_dir`, and `cwd` on `session/new` / `session/load`).

These flags parse in front of `agent` (verified with `--help`). `grok agent --deny` does not parse. `dontAsk` denies anything that is not pre-approved instead of blocking on a prompt. `deny` wins over allow rules in the user's `~/.grok/config.toml`. `--no-subagents` and `--disable-web-search` close the extra doors those flags name.

Rust still answers any ACP permission request that arrives. The expected method is the ACP standard `session/request_permission`. The probe records the real method and payload. The answer allows a call only when the payload names a read, list, search, or edit tool: internal ids `read_file`, `list_dir`, `grep`, `search_replace`, `write`, or permission classes `Read`, `Grep`, `Edit`, `Write`. Every other call is denied. A request must never wait on the UI. The probe records which of those names the payload actually uses.

`initialize` does not advertise filesystem or terminal client capabilities.

### Session lifecycle

1. `initialize`
2. `session/new` with `cwd` and `mcpServers: []`, or `session/load` with `sessionId`, `cwd`, and `mcpServers: []`
3. `session/prompt` with the user text
4. `session/update` notifications while the prompt is in flight
5. The `session/prompt` result is `turn_done`

`session/new` and `session/load` return `configOptions`. The model list the picker shows is the output of `grok models` at the time of this spec:

- `grok-4.7` (default for a new session)
- `grok-4.7-build-fast`
- `grok-4.6`
- `grok-4.5`

A live switch is `session/set_config_option` with `configId: "model"` and `value: { "value": "<id>" }`.

### Updates that become events

| `sessionUpdate` | Normalized event |
|---|---|
| `agent_message_chunk` | `text_delta` |
| `tool_call` | `tool_start` |
| `tool_call_update` | `tool_done` when the call finishes |
| `agent_thought_chunk`, `plan` | ignored |

The `session/prompt` response becomes `turn_done`. Cost is included when that response carries it. Grok often omits cost on OAuth sessions; the footer then omits the dollar amount and still shows that the turn finished.

---

## 7. Data flow

A new session is a row: frontend UUID, folder, label (folder basename), turtle, and model. No process until the first send.

**First message.** `ensureRunning` spawns the process, `initialize`, `session/new`, stores `agentSessionId`, then `session/prompt`.

**Later message, process alive.** `session/prompt` only. A model change is `session/set_config_option` and does not restart the process.

**Asleep (restart, or the process died).** The next send spawns, `initialize`, `session/load` with the stored id and the same folder, then `session/prompt`.

**Two sends.** One session has a single start promise and a send queue, so two quick sends start one process and the prompts go out in order. Closing during a start is recorded and the child is killed when the start finishes.

**Turn finished.** `turn_done` closes the card. Notification title is `<project> · <session label>`.

- Looking at that session with the window focused: no sound, no notification, no unread dot.
- Focused on another session, or the window in the background: unread dot, webview sound, and an OS notification. The body is the first 80 characters of the reply. A session ending uses the second sound and the text "Session ended".
- If the OS notification cannot be delivered, the dot and the sound still happen.

**Saving.** Trailing throttle, at most once a second, always the latest state. Rust writes `state.json.tmp` and renames it over `state.json`.

**Close.** Remove the session from the map, kill the child, delete the row.

Switching sessions drops the half-typed draft. The chat view is keyed by session id.

---

## 8. Error handling

- Check the folder before looking for `grok`. "Folder does not exist" and "could not find `grok` on PATH" are different errors.
- Resolve PATH once per run with an interactive login shell (`$SHELL -ilc`), wrapped in markers, with stdin `/dev/null` and a timeout. Cache it. This covers a WSLg launch and a macOS Dock launch, both of which get a thin PATH.
- Drain stderr. Attach it to `process_exited`. On EOF, drop the session from the map, then emit `process_exited`.
- Skip unparseable stdout lines.
- `session/load` of a missing session: emit `resume_failed`, clear `agentSessionId`, put the unsent text back in the composer. The card says the next message starts a fresh conversation. The missing-session check is the error shape recorded by the probe (section 12), so an auth failure is not treated as a missing session.
- Any other start or load failure, including auth: keep `agentSessionId`, show the error, put the text back in the composer. The user bubble is added only after `session/prompt` is written. Until then the text stays in the composer.
- A process that dies mid-turn shows "Session ended" with stderr. The next send uses `session/load` when an id is stored.
- A denied tool is a tool row.
- The folder picker is the Tauri dialog, starting at the current session's folder. A typed path is always available beside it.
- Corrupt `state.json`: rename to `state.corrupt-<unix-seconds>.json`, start empty, show a banner.
- A read error that is not corruption: disable saving for that run.
- On load: sessions are asleep, a half-finished reply is marked done, unread and error flags are cleared.

---

## 9. Platform

| Concern | macOS | Linux / WSL |
|---|---|---|
| State file | `~/Library/Application Support/<bundle-id>/state.json` | `$XDG_DATA_HOME/<bundle-id>/state.json`, or `~/.local/share/<bundle-id>/state.json` |
| Finding `grok` | Login-shell PATH | Login-shell PATH. Typical install is `~/.grok/bin/grok`. |
| Links | `opener` plugin | `opener` plugin (`xdg-open`, which WSLg forwards to Windows) |
| Sound | Webview | Webview |
| Notifications | Tauri notification plugin | Same plugin. WSLg may drop the toast. The unread dot does not depend on it. |
| Folder picker | Tauri dialog | Tauri dialog, plus the typed path |

The title bar matches the dark sidebar (`titleBarStyle: "Transparent"`, `hiddenTitle: true`, background `#1f2328`) on both platforms where the window manager allows it.

---

## 10. UI carried over from the Claude app

- Projects: a switcher at the top of the sidebar, create and rename, delete only when the project is empty and it is not the last project. Sessions in other projects keep running and keep notifying.
- New session reuses the folder of the session on screen. Browse opens the folder picker. Double-click renames. Close kills the process and deletes the row.
- Turtles, first free within the project: Leonardo `#2f6fdb`, Raphael `#e23b3b`, Donatello `#8a4fd8`, Michelangelo `#f28c28`, then Splinter, April, Casey. The colour is the card stripe, the sidebar mark, the unread dot, the Send button, and links.
- User messages are right-aligned bubbles. Agent replies are cards: turtle and model in the header, ordered blocks, footer with cost (when known) and turn count.
- The thinking line rotates on a timer while a turn is open.
- Markdown is GitHub-flavoured. Code blocks have Copy. Links open in the system browser. Images are not loaded; they render as an alt link.
- Theme variables live in one CSS file. Emoji stay in the chrome, not inside agent text.
- New sessions start on `grok-4.7`. The header dropdown switches a running session live and an asleep session on its next start. The model badge is on the sidebar row and the card.

---

## 11. Security

The webview can invoke the commands that drive agents. The same limits as the Claude app apply:

- No raw HTML in markdown. No `rehype-raw`.
- The link renderer opens only `http(s)` and `mailto` through the opener plugin, with `preventDefault`.
- The navigation guard blocks any other origin.
- The child is spawned with a fixed argument list. User text is a JSON-RPC parameter, not a shell string.
- Tool policy is the spawn flags in section 6 plus the permission-request answer. The user's Grok config cannot widen it: `deny` beats a config `allow`, and a permission request is denied unless the tool is on the allowlist.
- `withGlobalTauri` and `csp: null` are dev-only.

---

## 12. Testing

### Probe, before implementation freezes protocol details

One throwaway `grok agent --no-leader stdio` in a temp directory, using the spawn flags from section 6. Record the transcript, then discard the process. The spec is updated with anything that differs.

Pass criteria:

1. `initialize` and `session/new` return a session id.
2. One short prompt streams `agent_message_chunk` (or the probe records the update type that actually carries text).
3. A prompt that would run a shell command is denied, and the tool does not run.
4. A new process can `session/load` that id and recall a codeword from the first prompt.
5. `session/load` of an unknown id fails in a way the app can tell apart from an auth failure.
6. `session/set_config_option` for `model` succeeds on the live process.
7. The permission-request method, if one is sent, is written down verbatim.

### Vitest

Turtle assignment, tool-row summaries, the reducer (text, tool, text; identity of untouched blocks), hydrate/serialize including a corrupt file and a half-finished reply, project delete rules, session rules (resume vs fresh, composer restore, clearing `agentSessionId` only for "session not found").

### Rust

Navigation guard. State file round trip, temp file removed, quarantine. Permission decision for the allowlist and for shell, web, and MCP. Fixture of `session/update` lines mapping to normalized events. State-directory path on macOS and on Linux.

### Manual

Streaming, tool rows, markdown, Copy, links, raw HTML left as text. Two sessions in two folders. Notifications in the three focus states. A codeword surviving quit and relaunch. Failed resume, corrupt state file, missing folder, `grok` not on PATH. Live model switch. Typed folder path. One launch from a terminal inside WSL, and one launch the way the WSLg window will actually be opened.

---

## 13. Out of scope for the first build

- The Gemini backend.
- Warming a session when its row is selected, before the user types.
- `fsync` before the state-file rename, and sequencing overlapping saves.
- Auto-scroll, and fixing low-contrast link colours for light turtles.
- Rebuilding streaming markdown incrementally.
