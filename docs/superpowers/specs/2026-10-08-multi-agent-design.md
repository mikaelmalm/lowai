# Grok, Antigravity, and Claude — Design

Each chat session is bound to one agent CLI, chosen when the session is created. Grok and Antigravity (`agy`) stay as one warm process. Claude is one `claude -p` process per turn. All three can use the tools their CLIs allow. A Grok or Claude tool that needs approval waits on an Allow or Deny card in the chat. Antigravity headless mode has no approval prompt: tools follow that CLI’s own settings, and a tool that would ask is soft-denied. The app does not pass `--dangerously-skip-permissions`.

The in-app terminal is unchanged. Windows and Mac stay out of this spec.

---

## 1. Decisions

| Topic | Choice |
|---|---|
| Transport | Grok: `grok agent stdio`. Antigravity: `agy --input-format stream-json --output-format stream-json`, one warm process. Each prompt is one stdin line, `{"event":"user","message":{"content":"..."}}`. Claude: `claude -p --output-format stream-json`, a new process per turn. |
| When the agent is chosen | At session creation. It is stored on the session and does not change. |
| Who appears in the control | Only CLIs found at app startup. |
| Lookup | The login shell’s `PATH`, the same way Grok is found today, plus `~/.grok/bin/grok` for Grok. |
| Default selection | The first found of Grok, then Antigravity, then Claude. |
| Tools | No app deny list. The `grok-guard` directory is not passed to Grok. |
| Approval | Allow and Deny in the transcript for Grok and Claude. The process waits. The first answer is sent. A second click does nothing. |
| Grok approval | The ACP permission reply on the warm process. |
| Antigravity approval | None. Headless `agy` cannot take an answer on stdin. `control_request` ends the session. The CLI’s permission settings decide. Asking tools are soft-denied. |
| Claude approval | `--permission-prompt-tool` pointed at a stdio MCP server the app runs for that process. The tool call blocks until Allow or Deny. |
| Close or quit during a prompt | Send Deny, then kill the process. |
| Models | The header lists only that agent’s models. Grok keeps `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, and `grok-4.5`. Antigravity uses the ids from `agy models` on this machine, default `gemini-3.8-flash-high`. Claude ids are `sonnet`, `opus`, and `haiku`. The default for a new session is the first id in that list. |
| Model change | Grok updates the warm process. Antigravity stores the model and restarts `agy` on the next message, because the model is a launch flag (`/model` is rejected on the stream). Claude stores the model and passes it on the next `claude -p`. |
| Old saves | A session with no `agent` field loads as `grok`. A saved `gemini` agent loads as `agy`. A model id that is not in that agent’s list becomes the agent’s default. |

---

## 2. Goals and non-goals

**Goals**

- Create a session on Grok, Antigravity, or Claude, whichever of those CLIs exist on this machine.
- Keep one conversation per session, resumed with that CLI’s conversation id.
- Show text and tool calls in the transcript the way Grok does today.
- Let the person approve or refuse a tool in the chat.

**Non-goals**

- Switching a session from one agent to another.
- API keys in the app.
- A shared ACP adapter for Claude.
- Changing the terminal, the sidebar, or which tools the user’s own CLI config already allows.
- Windows and Mac.

---

## 3. Startup lookup

On launch the app resolves `grok`, `agy`, and `claude`. A name is available only when that lookup returns a file. The sidebar agent control lists those names, in the order Grok, Antigravity, Claude. The selected one is what **New session**, **Browse**, and the typed folder use.

If the saved selection is not in the list, the selection becomes the first available. If the list is empty, the control is empty and those three actions do not create a session. A system card says no agent CLI was found.

A CLI installed after launch is absent until the next launch.

---

## 4. Session and models

`Session` gains `agent: "grok" | "agy" | "claude"`. The session row shows the agent beside the model.

Creating a session copies the sidebar selection and that agent’s default model. The first message calls `start_session` with the agent, the folder, and the model. No process exists before that.

Grok spawns `grok agent stdio` with no guard directory. Antigravity spawns `agy` with `--input-format stream-json`, `--output-format stream-json`, `--model`, and `--add-dir` set to the session folder, which is also the working directory. `--conversation` is passed when an id is already stored. There is no `-p` prompt and no `--dangerously-skip-permissions`. Both keep the process. Claude does not spawn at `start_session`. The first `claude -p` is the first message.

The app stores the conversation id from Antigravity’s `init` event, and the id Grok and Claude return. Later Grok and Antigravity messages go to the warm process. Antigravity prompts are user events on stdin. A new Antigravity process resumes with `--conversation`. Later Claude messages are `claude -p` in the folder with `--output-format stream-json`, `--model`, and `--resume` when an id is stored.

A second message waits until the current turn finishes, including a permission wait.

---

## 5. Permission card

A permission request inserts a card in the transcript, separate from a finished tool row. The card shows the tool name, a short form of the input, and **Allow** and **Deny**. The turn stays unfinished until one is chosen.

For Grok the answer is the ACP permission reply. For Claude the answer unblocks the MCP tool `approve_tool` on the stdio server attached to that `claude -p` process. Antigravity does not emit a permission card.

A request on a session that is not visible sets that session’s unread dot. Closing the session, or quitting the app, while a card is open sends Deny and then kills the process.

---

## 6. Error handling

If the binary is gone by the time a message is sent, the session stays asleep, the draft returns to the composer, and a system card names the missing command.

A process that exits mid-turn shows the existing exit card and drops the warm entry. The next message starts again and passes the saved conversation id when there is one. If the CLI says that id is gone, a system card says so, the id is cleared, and the transcript stays. The message after that starts a new conversation.

A model id the CLI rejects is a system card. The session keeps the previous model. A process that died because of the bad id is not kept.

---

## 7. Testing

Rust, with no real CLI:

- A Grok launch command is `grok agent stdio` and does not include the guard directory.
- An Antigravity launch command is `agy` with stream-json input and output, the model, `--add-dir` of the session folder, and `--conversation` only when an id is stored. It does not include `-p` or `--dangerously-skip-permissions`.
- A Claude turn includes `-p`, `stream-json`, and the model, and includes `--resume` only when an id is stored.
- The lookup returns only names whose binaries exist. An empty result is an empty list.
- The first Allow is delivered once. A second answer is not sent. Closing the session sends Deny and then clears the process.

Webview:

- The control lists only the agents the startup lookup returned.
- Creating a session stores that agent. An old save with no agent loads as `grok`. A saved `gemini` agent loads as `agy`, and an unknown model becomes that agent’s default.
- The model menu lists that agent’s models.
- A permission card shows the tool name and both buttons.

On the Linux window, with Grok and Antigravity installed and Claude absent: the control shows Grok and agy. A Grok session can run a tool, and Allow continues the turn. A resume id the CLI rejects shows the system card, and the next message still sends.

---

## 8. Out of scope reminder

`docs/features.md` still lists Windows and Mac. This spec ends when a Linux session can be Grok, Antigravity, or Claude, and a Grok or Claude tool approval is answered in the chat.
