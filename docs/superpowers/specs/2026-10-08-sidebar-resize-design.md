# Sidebar resize and hide — Design

The sidebar can be dragged wider or narrower, and it can collapse completely. The width and the hidden choice belong to the app, not to a session.

---

## 1. Decisions

| Topic | Choice |
|---|---|
| Hide | The sidebar leaves the layout. No strip remains. |
| Show again | A Sidebar button, and `` Ctrl+B ``. Both toggle. |
| Button | In the chat header, immediately before Terminal. The empty start screen has the same button. |
| Shortcut while the terminal is focused | Not handled. Zsh keeps `` Ctrl+B `` as cursor-left. The button still toggles. |
| Width | One saved number for the app. Default 280. Minimum 180. |
| Chat | The chat column keeps at least 320 pixels. A visible terminal’s width counts toward that limit. |
| Sash | On the sidebar’s right edge, same drag pattern as the terminal divider. Hidden while the sidebar is hidden. |
| Persistence | `sidebarWidth` and `sidebarHidden` are saved with the app state. A restart restores both. |

---

## 2. Goals and non-goals

**Goals**

- Drag the sidebar and have that width come back after a restart and after switching sessions.
- Hide it so the chat and terminal use the space, then show it at the last width.
- Toggle with the button from the chat, from the empty screen, and with `` Ctrl+B `` outside the terminal.

**Non-goals**

- A per-session sidebar width.
- A thin icon strip, an activity bar, or a second sidebar.
- Changing what the sidebar lists.

---

## 3. Behavior

The sidebar starts at its saved width. The sash is the border between the sidebar and the rest of the window. Dragging it to the right grows the sidebar. The resulting width is clamped to at least 180 and at most `window width − chat minimum − visible terminal width`. The chat minimum is 320. When the terminal pane is hidden, its width is treated as 0. When the window is too narrow for 180 plus those reservations, the sidebar stays at 180 and the chat may shrink.

The Sidebar button and `` Ctrl+B `` flip `sidebarHidden`. Showing it does not change the saved width. While `sidebarHidden` is true, the sidebar and the sash are not rendered.

`` Ctrl+B `` is ignored when the focused element is inside the terminal pane. It is handled from the composer, the sidebar, and the empty screen. The handler calls `preventDefault` only when it toggles.

---

## 4. State

`AppState` gains:

- `sidebarWidth: number`
- `sidebarHidden: boolean`

`freshState` uses 280 and false. `hydrate` keeps a finite `sidebarWidth` and a boolean `sidebarHidden`. Any other value for the width becomes 280. Any other value for the flag becomes false. Older saves that lack both fields load as 280 and visible.

Dragging calls the same save path as the rest of the app state. Hiding does too.

---

## 5. Testing

- A save with no sidebar fields loads width 280 and visible.
- A save with width 360 and hidden true loads those values.
- A non-numeric width loads as 280. A non-boolean hidden flag loads as visible.
- The shortcut helper ignores `` Ctrl+B `` when the terminal is focused, and toggles otherwise.
- On the window: drag the sidebar, hide it, switch sessions, restart, and confirm the width and the hidden choice survived.

---

## 6. Out of scope reminder

Windows, Mac, Gemini, and Claude stay on `docs/features.md` as separate work. This spec ends when the sidebar can be resized and hidden on the Linux app.
