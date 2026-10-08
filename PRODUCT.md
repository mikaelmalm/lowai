# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The first user is Mikael, at his own machine, running several agent sessions while he works in those folders. Other developers who install lowai come later. The workflow is his. A session should still be understandable to someone who did not build the app.

## Product Purpose

lowai is a desktop window of parallel headless coding-agent sessions. Each session is tied to a folder. Success is being able to keep several agents working at once, see what each one is doing, approve the tools that ask, and use that session's terminal without leaving the window.

## Positioning

Each session is a warm process of an official CLI, not a call to a model API. The chat, the folder, and the terminal belong to that one session. A neighboring chat app that only sends prompts cannot truthfully claim that.

## Operating Context

Mikael develops on Linux inside WSL and runs the window through WSLg. The same app is built for Windows and Mac. The terminal is the platform shell: bash on Linux, PowerShell on Windows, zsh on Mac. On Windows, grok, agy, or claude may live only in the default WSL distro and then start through wsl.exe. The CLIs are installed on the machine. The app does not ship them.

## Capabilities and Constraints

- Agents are the official CLIs only: Grok (`grok`), Antigravity (`agy`), and Claude (`claude`). The agent is chosen when the session is created and is not switched later.
- Each session has its own resizable terminal beside the chat, and its own folder.
- Grok and Claude ask for tool approval in the chat. The first answer wins. Antigravity does not get an approval card.
- Startup shows only the CLIs it can find. If none are found, it does not create a session.
- The product name is lowai. The bundle id is `com.malm.lowai`. The window is a web view inside a Tauri shell, with one design language on Linux, Windows, and Mac.
- Undecided: how a new installer should introduce the app to someone who is not Mikael. Apple signing and notarization are not part of the product yet.

## Brand Commitments

The name is lowai, written in lowercase. It was chosen because it carries "low" from the city under the plate, lo-fi, and AI. That is a name, not a visual system.

## Evidence on Hand

The running app, `docs/features.md`, and the repo at https://github.com/mikaelmalm/lowai are the record. There is no marketing site, testimonial, pricing, or license statement. Do not invent any of those.

## Product Principles

- Design for the person already in the work, and keep a session legible to someone who just installed it.
- The agent is the official CLI on the machine.
- A session is one folder, one agent chosen once, a chat, and that session's terminal.
- Tool approval stays in the chat for the agents that can ask.
- The window is a desk of sessions, not one chat thread.
