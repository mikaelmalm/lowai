## Features

- Need a terminal (PTY) that should hook into the shell and provide a way to send commands and receive output.
  - it needs to be resizable and support scrolling.

- option to hide/resize sidebar

- OS support
  - Linux support
  - Windows support. The terminal starts PowerShell. CLI lookup reads the User and Machine PATH, then the default WSL distro, and launches a WSL-only CLI with wsl.exe. Claude's permission bridge listens on localhost.
  - Mac support. The terminal starts zsh. CLI lookup uses the login shell. The sidebar shortcut is Command-B. Claude's permission bridge uses a Unix socket, same as Linux.

- Agents support
  - Grok
  - Antigravity (agy)
  - Claude
