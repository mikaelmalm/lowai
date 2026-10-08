# lowai

lowai is a desktop window for several coding-agent sessions at once. Each session is one folder, one official CLI chosen when the session starts (`grok`, `agy`, or `claude`), a chat, and that session's terminal. The app runs those CLIs on the machine. It does not call a model API, and it does not ship the CLIs.

## Prerequisites

- Node.js 20.19 or newer, or 22.12 or newer
- pnpm 10
- Rust, installed with [rustup](https://rustup.rs) (the stable toolchain)
- The system libraries [Tauri](https://v2.tauri.app/start/prerequisites/) needs for the webview

On Debian or Ubuntu, including a typical WSL setup:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

On macOS, install the Xcode command line tools. On Windows, install the Microsoft C++ build tools with the "Desktop development with C++" workload, and the WebView2 runtime. Use the MSVC Rust toolchain (`rustup default stable-msvc`).

A session can start only when its CLI is installed and on `PATH`. The window lists the ones it finds: `grok`, `agy`, and `claude`.

## Develop

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the Vite dev server and the Tauri window.

```sh
pnpm test
cargo test
```

`pnpm build` produces an installer for the current platform.
