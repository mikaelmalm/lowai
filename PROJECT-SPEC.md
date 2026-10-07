# Claude Headless Chat — Project Spec

A macOS desktop app that runs several headless coding-agent sessions
(`claude -p` in streaming-JSON mode) side by side. Each session works in its
own folder (typically one git worktree per ticket), sessions are grouped into
named projects, and everything is saved and resumed across app restarts.
Replies render as markdown cards in a subtle TMNT-themed UI, with notifications
when an agent finishes while you're looking elsewhere.

This document describes what was built, how, and what was learned. It is
written so it can be handed to another model as a build prompt, either for
the same app or for a similar app driving a different agent CLI. Facts
marked **(verified)** were confirmed by running the real CLI; don't
re-derive them, but do re-check them if the CLI version differs.

---

## 1. Goals and non-goals

**Goals**
- Run ~3 agent sessions in parallel, each in its own working directory, and
  tell them apart at a glance.
- Stream replies live, token by token, with tool calls visible.
- Keep everything across restarts and resume the same agent conversation.
- Notice when an agent finishes and is waiting for you, even in another
  session, project or app.
- A pleasant, readable UI that's fun to keep open all day.

**Non-goals (deliberately not built)**
- In-app permission prompts. Tools are pre-approved; only `Read` is
  allowed.
- In-app re-authentication. Credentials must be valid before a session
  starts.
- Syncing between machines, export, or archiving closed sessions.
- Windows or Linux support. macOS only, though the stack is
  cross-platform.

---

## 2. Tech stack

| Layer | Choice | Version used |
|---|---|---|
| Desktop shell | Tauri v2 | `tauri` 2.12.1, CLI 2.12.1 |
| Backend | Rust (tokio, serde_json, uuid) | rustc 1.99, tokio 1.53, uuid 1.27 (v4) |
| Frontend | React + TypeScript + Vite | React 19.3, TS 6.0, Vite 8.3 |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js` (`github` theme) | 10.1.0 / 4.0.1 / 7.0.2 / 11.12.0 |
| Tauri plugins | `opener` (open links), `dialog` (folder picker), `notification` | 2.7.0 / 2.8.1 / 2.5.1 |
| Tests | Vitest (pure TS modules), `cargo test` (Rust) | Vitest 5.0.3 |
| Agent CLI | Claude Code | 2.1.292 |
| Package manager | pnpm | 10.x |

No state library, router, CSS framework or database. Plain React state
in one hook, plain CSS with CSS variables, and one JSON file on disk.

---

## 3. Architecture

```
┌──────────────── React webview ────────────────┐
│ App ── Sidebar (ProjectSwitcher, session list) │
│     └─ ChatView (header, cards, composer)      │
│ useSessions hook: all state, event routing,    │
│   start/resume, saving, notifications          │
│ Pure modules: chat/blocks, chat/tools,         │
│   state/persist, state/projects, theme/turtles │
└──────────────▲──────────────┬──────────────────┘
               │ "claude-event" (Tauri event,   │ invoke(...) commands
               │  every JSON line + _session_id)│
┌──────────────┴──────────────▼──────────────────┐
│ Rust: HashMap<sessionId, {child, stdin}>        │
│  per session: stdout reader task, stderr drain │
│  persist.rs (state.json), sound.rs, nav_guard  │
└──────────────▲──────────────┬──────────────────┘
               │ stdout NDJSON                 │ stdin NDJSON
         ┌─────┴───────────────▼─────┐
         │ claude -p --input-format   │  one long-lived child
         │ stream-json ...            │  process per session
         └────────────────────────────┘
```

**Key decisions**
- **One long-lived process per session, multi-turn over stdin.** We don't
  respawn per message, so context stays in the process and follow-up turns
  are fast.
- **One shared event channel.** Rust injects a `_session_id` field into
  every JSON line before emitting it on a single Tauri event
  (`claude-event`). The frontend routes each event by that field. This is
  simpler than one channel per session.
- **Session IDs are owned by the frontend** (`crypto.randomUUID()`) and are
  permanent, which is what makes resume work: the saved chat, the sidebar
  entry and a newly started process all share one ID. Claude's own
  conversation ID is stored separately as `claudeSessionId`.
- **Lazy resume.** After a restart, no processes run. A session's process
  starts on its first message, with `--resume <claudeSessionId>`.
- **Stream events are reduced into ordered blocks** (text, tool, text…) by
  a pure reducer, so cards show text and tool calls in the order the agent
  produced them.

---

## 4. Agent CLI protocol (Claude Code)

### Command line (verified)

```
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --include-partial-messages \
  --allowedTools Read \
  [--model <alias|full-name>] \
  [--resume <claudeSessionId>]
```

- `--output-format stream-json` **requires** `--verbose` with `-p`. Without
  it you get: *"When using --print, --output-format=stream-json requires
  --verbose"*.
- **Without `--include-partial-messages`, no `stream_event`s are emitted.**
  You only get complete `assistant` messages and a final `result`, so
  nothing streams. This flag is what turns on token-level deltas.
- `--model` takes an alias (`fable`, `opus`, `sonnet`) or a full model name.
- Set the working directory with the child's `current_dir`, not a flag.
- The CLI loads the user's own config: CLAUDE.md, hooks, plugins and MCP
  servers. That costs about **2.6s of startup** before `system/init`
  (measured). `--bare` skips all of it, which makes startup fast but loses
  the user's skills and instructions. We kept the full config.

### Input (stdin, one JSON object per line)

```json
{"type":"user","message":{"role":"user","content":"…text…"}}
```

Switching the model of a **running** session needs no restart (verified):

```json
{"type":"control_request","request_id":"<uuid>","request":{"subtype":"set_model","model":"sonnet"}}
```

The CLI answers with a `control_response` (`subtype: "success"`), and the
next turn uses the new model. Switching back to "default" was not verified,
so the app doesn't offer it.

### Output events (stdout, one JSON object per line)

| `type` | What it is | Notes |
|---|---|---|
| `system` / `subtype: "hook_started"`, `"hook_response"` | the user's SessionStart hooks | ignore |
| `system` / `subtype: "init"` | process ready: `session_id`, `model`, `tools`, … | sent **before each turn**, not only once; `session_id` is the conversation ID to store |
| `stream_event` | raw API streaming event in `.event` | see below |
| `assistant` | complete assistant message | ignore when streaming |
| `result` | turn finished: `result` (text), `total_cost_usd`, `num_turns`, `subtype`, `is_error`, `ttft_ms` | |
| `control_response` | reply to a `control_request` | |

`stream_event.event.type` values:
- `message_start`. **Content-block indexes restart at 0** for every API
  message, and one turn can contain several, for example text, then a tool
  call, then more text after the tool result.
- `content_block_start` with `content_block.type`:
  - `text`
  - `tool_use` (with `name`)
  - `thinking`, which is ignored
- `content_block_delta` with `delta.type`:
  - `text_delta` (`text`)
  - `input_json_delta` (`partial_json`, the tool input in pieces)
  - `thinking_delta` and `signature_delta`, which are ignored
- `content_block_stop`. Parse the buffered tool-input JSON here.
- `message_delta` and `message_stop`.

### Resume (verified)

- `--resume <id>` in stream-json mode restores full context. A codeword told
  to one process was recalled by a later process.
- `system/init` reports the **same** `session_id` after resuming, so each
  conversation has one stable ID.
- **A bad or missing ID** emits exactly one `result` event
  (`subtype: "error_during_execution"`, `is_error: true`) and **no `init`**.
  It prints `No conversation found with session ID: <id>` to stderr and
  exits with code 1. Detect it as "exited before `init`" *and* that stderr
  text. Ignore that error `result`, otherwise you'll show a bogus "done"
  card and notification.

### Permissions in headless mode

There's no TTY, so anything not pre-approved is denied automatically. The
model may still *attempt* other tools (for example Bash for "what folder am
I in?"): a `tool_use` block appears, the call is denied, and the model works
around it. The UI renders every attempted tool call.

---

## 5. Features

### Sessions
- A session is created in a folder. **🍕 New session** reuses the folder of
  the session you're viewing; **📂 Browse…** opens the native folder picker,
  starting at the current session's folder.
- The label defaults to the folder's basename, and double-clicking renames
  it.
- **×** kills the process and deletes the session.
- Each session gets a turtle (name and colour), the first one free *within
  its project*: Leonardo `#2f6fdb`, Raphael `#e23b3b`, Donatello `#8a4fd8`,
  Michelangelo `#f28c28`, then the allies Splinter, April and Casey. The
  colour is used for the card stripe, the sidebar mask, the unread dot, the
  Send button and links.
- A process that dies mid-run shows "💥 Session ended" with its stderr.
  The session goes to sleep and the **next message resumes it**; the input
  is never permanently locked.

### Projects
- Projects are named groups of sessions from any folders. A switcher
  (`📁 <name> ▾`) sits at the top of the sidebar, and only the active
  project's sessions are listed.
- Create with "➕ New project…" (Enter commits, Escape cancels) and rename
  by double-clicking. **Delete** only appears for an empty project, and
  never for the last one, so there's no confirm dialog and nothing can be
  lost by accident.
- Sessions in other projects keep running and keep notifying.

### Saved state and resume
- Everything is saved to
  `~/Library/Application Support/<bundle-id>/state.json`: projects, the
  active project, and each session's label, folder, model, turtle,
  `claudeSessionId` and messages.
- Saving is a **trailing throttle**: at most once per second, always writing
  the latest state. A plain debounce would never fire during a long
  streaming reply.
- Rust writes atomically: `state.json.tmp`, then a rename.
- **A corrupt file** is renamed to `state.corrupt-<unix-seconds>.json` and
  the app starts fresh with a banner. **A read error** (as opposed to
  corruption) disables saving for that run, so a file the app couldn't read
  is never overwritten.
- On load, sessions are asleep, half-finished replies are marked done, and
  unread and error flags are cleared.
- The first message to a sleeping session starts `claude` with `--resume`.
  The input shows "Waking Leonardo…" and a pending card shows the thinking
  line.
- If resume fails, the card says "💥 Couldn't resume — your next message
  starts a fresh conversation" and the stale ID is cleared. The ID is
  **only** cleared on the "No conversation found" stderr; other early
  failures, such as expired auth, keep the link.

### Models
- New sessions start on the default model. The chat header has a model
  dropdown (fable, opus, sonnet) that switches a running session live via
  `set_model`; for a sleeping session the choice is applied at its next
  start.
- The chosen model appears as a badge in the sidebar and in each card
  header.

### Chat UI (layout "B" plus subtle TMNT)
- Your messages are light right-aligned bubbles. Agent replies are white
  cards with a turtle-coloured left stripe:
  - header: `🐢 Leonardo · opus` plus the time
  - body: ordered blocks
  - footer: `🍕 $0.0123 · 2 turn(s)`
- Tool rows show an icon, the name and **one key argument**:

  | Tool | Icon | Key argument |
  |---|---|---|
  | Read | 📜 | `file_path`, relative to the session folder |
  | Bash | ⚔️ | first line of `command`, truncated to 80 chars |
  | Grep, Glob | 🔍 | `pattern` |
  | Edit, Write | ✍️ | `file_path` |
  | WebFetch | 🌐 | `url` |
  | Task | 🔧 | `description` |
  | anything else | 🔧 | first string value |

- The thinking line rotates every 3s: "🥷 sneaking through the code…",
  "🥷 sharpening katanas…", "🍕 ordering pizza…", "🐢 consulting Splinter…".
- Markdown:
  - GitHub-flavoured: tables, lists and highlighted code blocks.
  - Code blocks get a Copy button.
  - **Links open in the system browser.**
  - **Images are never loaded**; they show as a `🖼 alt` link.
- The theme lives in CSS variables in `theme/theme.css`:
  - dark sidebar `#1f2328`, active row `#2c323a`, light content area
    `#f4f5f7`
  - per-session `--turtle`
  - system fonts
  - emoji only in the surrounding UI, never inside agent text

  A different theme (for example Mario) would be a new set of variable
  values plus an emoji map.
- The macOS title bar is set to `titleBarStyle: "Transparent"`,
  `hiddenTitle: true` and `backgroundColor: "#1f2328"`, so it matches the
  sidebar.
- Switching sessions clears the half-typed draft (`ChatView` is keyed by
  session ID), so text never goes to the wrong session.

### Notifications
- **Triggers:**
  - a turn finished (`result`): "🍕 Done, waiting for you: <first 80
    chars>" with the Glass sound
  - a session ended: "💥 Session ended" with the Basso sound
  - the title is `<project> · <session label>`
- **If you're looking at that session and the app is focused:** nothing.
- **App in the background:** a real OS notification with its sound.
- **App focused, another session:** macOS **suppresses** notification
  banners and sounds for the frontmost app, so the app plays the sound
  itself via `/usr/bin/afplay /System/Library/Sounds/<Name>.aiff`. It also
  sets a sidebar unread dot, cleared when you open that session.

---

## 6. Backend (Rust) reference

| Command | Purpose |
|---|---|
| `start_session(session_id, cwd, model?, resume?)` | spawn `claude` in `cwd` (with `~` expanded); refuses an ID that's already running; separate errors for "folder does not exist" and "could not find `claude` on PATH" |
| `send_message(session_id, text)` | write a user-message line to the session's stdin |
| `set_model(session_id, model)` | write a `set_model` control request |
| `close_session(session_id)` | remove the session from the map and kill the child |
| `load_app_state()` / `save_app_state(json)` / `quarantine_app_state()` | the state file (`Ok(None)` when it's missing) |
| `play_sound(name)` | `afplay` a system sound; accepts only alphanumeric names, never a path |

**Per-session tasks**
- A **stdout reader** parses each line, adds `_session_id`, and emits it.
  Unparseable lines are logged and skipped.
- On EOF the reader removes the session from the map and emits a synthetic
  `{"type":"process_exited","stderr":…}`.
- A **stderr drain** collects stderr, which is attached to `process_exited`.
  An unread stderr pipe can block the child once its buffer fills.

**Plugins**
- `nav_guard`: an `on_navigation` hook that only allows `tauri://localhost`
  (release) and, in dev only, `http://localhost`. Every other navigation is
  cancelled. Tauri's `cfg(dev)` is true exactly when it's built without the
  `custom-protocol` feature, which is the case for `tauri dev`.

---

## 7. Frontend reference

```
src/
  App.tsx              layout shell, project filtering, banner
  Sidebar.tsx          project switcher, session list, New session / Browse
  useSessions.ts       ALL state + side effects (see below)
  components/          ChatView, AgentCard, UserBubble, SystemCard,
                       BlockView (memoized), Markdown, ToolCallRow,
                       CardErrorBoundary, ProjectSwitcher
  chat/                types.ts, blocks.ts (stream→blocks reducer), tools.ts
  state/               types.ts, persist.ts (hydrate/serialize), projects.ts,
                       session-rules.ts (resume/banner/in-flight rules)
  theme/               theme.css (variables), turtles.ts (roster + assignment)
  types/claudeEvents.ts  event type definitions
```

**Patterns in `useSessions` that matter**
- **Refs mirror state** (`sessionsRef`, `projectsRef`, `activeSessionIdRef`)
  so the single long-lived event listener always reads current values.
- **No side effects inside `setState` updaters.** StrictMode runs them
  twice, which would mean double notifications. Notifications, `invoke`
  calls and ref writes all happen outside updaters.
- **`ensureRunning(sessionId)`**: a synchronous `spawnRef` entry plus a
  shared start promise in `startsRef`. Two quick sends produce one process.
  Closing during a start is recorded in `closedRef`, and the session is
  killed once the start resolves.
- The **reducer keeps unchanged block objects identical**, so a memoized
  `BlockView` re-renders only the block that's still streaming.
- **The listener is registered once**, guarded by a ref, so the StrictMode
  double-mount doesn't register it twice.

---

## 8. Security model

The webview runs with `withGlobalTauri: true` and `csp: null`, so any
script injected into it could call commands that drive agents. Protections:

- **No raw HTML in markdown.** `react-markdown` without `rehype-raw` renders
  agent HTML as text. Never add a raw-HTML plugin.
- **The link renderer** only opens `http(s)`/`mailto` links, through the
  opener plugin, with `preventDefault`. Anything else renders as plain text.
  `react-markdown`'s default `urlTransform` already blanks `javascript:`
  and `data:` URLs.
- **The navigation guard** in Rust blocks right-click "Open Link" and any
  other route away from the app's UI.
- **No shell anywhere.** The process is spawned via `Command` with fixed
  arguments, and user text reaches stdin only as JSON-escaped strings
  (newlines are escaped, so no line injection).
- **`play_sound`** accepts only bare alphanumeric names.
- **Only `Read` is pre-approved** for the agent.

Hardening still open: `withGlobalTauri` and `csp: null` should be limited to
development builds.

---

## 9. Lessons learned (the expensive ones)

1. **Streaming needs `--include-partial-messages`.** Without it the UI
   received complete messages only and appeared to answer nothing while
   streaming. Diagnose by piping the exact payload into the CLI by hand.
2. **Finder/Dock-launched macOS apps get launchd's minimal PATH**
   (`/usr/bin:/bin:/usr/sbin:/sbin`).
   - Resolve the user's PATH once with an **interactive** login shell,
     `$SHELL -ilc`. A plain `-lc` skips `.zshrc`, which is where
     `~/.local/bin` (Claude's install folder) is often added.
   - Wrap the output in markers, because `.zshrc` may print to stdout.
   - Add a timeout and use stdin `/dev/null`.
   - Cache the result for the run.
3. **Testing "as if launched from Finder" is hard to fake.**
   `PATH=… ./binary` and `env -i` gave inconsistent results. `open X.app`
   from a terminal passed when real Finder launches failed. Verify the shell
   command itself in `env -i`, and have a human launch the real bundle.
4. **Tauri runs non-async commands on the main thread.**
   `tokio::process::Command::spawn` panics there ("no reactor running").
   With `panic = "abort"` in release builds, that's an instant app crash.
   **Make every command `async`.**
5. **macOS suppresses notification banners and sounds for the frontmost
   app.** If the user is in the app but on another session, play the sound
   yourself.
6. **Error messages must say which thing failed.** "failed to spawn claude:
   No such file or directory" is the same error for a missing folder and a
   missing binary. Check the folder first and say which one it was.
7. **Clear session state when the process exits**, or later writes hit a
   dead stdin with "Broken pipe" instead of a clean "no active session".
8. **Drain stderr** and attach it to the exit event. It's where auth,
   flag and API errors show up.
9. **Streaming deltas need an ordered-blocks model** that resets block
   indexes on every `message_start`. Keeping text and tool calls in
   separate lists glues pre-tool and post-tool text together.
10. **A failed `--resume` sends a `result`.** Only clear the stored ID on
    the specific "No conversation found" stderr. Clearing it on *any*
    early exit would sever every conversation the first time auth expires.
11. **Debounce vs throttle for saving.** A debounce never fires during a
    long stream; use a trailing throttle that reads the latest state from a
    ref.
12. **Never overwrite a state file you failed to read.** Quarantine
    corrupt files; disable saving after I/O errors.
13. **Latency.** Within a running session, reply speed is model speed (TTFT
    ~1.5s on Opus; Sonnet is faster). The ~2.6s CLI startup is paid per
    session start and per resume. Warming a sleeping session up when it's
    clicked would hide it; that isn't built yet.
14. **Tauri v2 doesn't expose `window.__TAURI__`** unless
    `withGlobalTauri: true`. Handy for devtools testing, but a security
    trade-off (see section 8).
15. **Swapping the binary inside a signed `.app` breaks its signature**
    ("Launchd job spawn failed"). Rebuild via `tauri build` rather than
    patching the bundle. Use `--bundles app` to skip the DMG step, which
    failed on this machine.
16. **Corporate npm registries** can return 401 for public packages. Use
    `npm_config_registry=https://registry.npmjs.org/` per command rather
    than changing global config.

---

## 10. Testing approach

- **Unit tests (Vitest), pure modules only:**
  - turtle assignment
  - tool-input summaries
  - the stream→blocks reducer, including the index reset across API
    messages, split JSON deltas, thinking blocks, and identity
    preservation
  - state hydrate/serialize, including the corrupt-input table
  - project rules
  - session rules
- **Rust tests:**
  - navigation guard allow/deny
  - the state file round trip, the temp file being cleaned up, and
    quarantine
- **Manual checklists for everything visual or process-driven:**
  - streaming
  - tool rows
  - markdown, Copy and links
  - raw HTML staying inert
  - multi-session isolation
  - notifications in each focus state
  - the bundled app launched from Finder
  - the codeword surviving a restart
  - failed resume and the corrupt state file
- Before trusting any CLI behaviour, **run the exact command by hand** with
  the exact payload. Several bugs were found that way, and several wrong
  assumptions were avoided.

---

## 11. Known limitations and deferred items

- A message sent to a session whose resume then fails isn't marked
  undelivered.
- Two sends in the same instant aren't strictly FIFO on the Rust side; a
  per-session send chain would fix that.
- No `fsync` before the rename, and saves aren't sequenced.
- A session created in the milliseconds before the first load completes
  is lost.
- Re-selecting the already-active project resets the selected session.
- One malformed session makes the whole state file count as corrupt (it's
  kept in quarantine).
- After a model switch, old cards show the new model's name.
- Streaming markdown is re-parsed in full on every delta, which grows
  quadratically for very long code replies.
- Light-coloured turtles (April) give low-contrast links.
- There's no auto-scroll to the newest message.
- `withGlobalTauri`/`csp: null` are set for release builds too.
- The exit code is always reported as `null`.

---

## 12. Porting to another agent CLI

The architecture (sections 3, 5, 7 and 8) carries over unchanged. Replace
the protocol layer: Rust `start_session`/`send_message`/`set_model`, plus
`chat/blocks.ts` and `types/claudeEvents.ts`. **Verify each of these by
running the CLI by hand before designing around it:**

1. **Headless mode.** Is there a non-interactive mode that streams
   machine-readable output (NDJSON or similar)? Which flags are *required*
   together? Remember the `--verbose` requirement above.
2. **Token streaming.** Does it emit partial deltas by default, or only
   behind a flag? What do text and tool-call events look like? Do block or
   index identifiers reset within a turn?
3. **Multi-turn over stdin.** Can one process take many messages, or must
   you respawn per turn? If you must respawn, how do you pass context back?
4. **Conversation identity and resume.** Is there a stable conversation ID,
   and where does it appear? Is there a resume flag? What exactly does a
   failed resume emit, on which stream, and with what exit code?
5. **Model selection.** Is there a start flag? Can you switch live over a
   control message, or only by restarting?
6. **Permissions.** How are tools approved headlessly, and what happens to
   an unapproved call: denied, or blocking on a prompt that will never come?
7. **Turn completion.** Which single event reliably marks "done, waiting for
   you"? It drives notifications, cost display and the thinking line.
8. **Startup cost and config loading.** What does the CLI load on start,
   and can it be skipped?
9. **Errors.** Where do auth, flag and API errors go: stderr, an event, or
   the exit code?
10. **Binary location.** Where does it install, and is that directory on a
    GUI app's PATH? Apply lesson 2.

Keep these patterns:
- one process per session, with `_session_id` injected into every event
- frontend-owned permanent session IDs
- the ordered-blocks reducer
- lazy resume
- atomic state saves with quarantine
- the navigation guard and no-raw-HTML rule
- all commands `async`
- stderr attached to exit events
