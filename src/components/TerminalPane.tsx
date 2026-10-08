import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { openSubscription } from "../lib/subscribe";

type Props = {
  sessionId: string;
  folder: string;
  width: number;
  hidden: boolean;
  focusToken: number;
  onHide: () => void;
  onKill: () => void;
  onExited: () => void;
};

export function TerminalPane({ sessionId, folder, width, hidden, focusToken, onHide, onKill, onExited }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrainsMono Nerd Font Mono", "Noto Color Emoji", monospace',
      scrollback: 5000,
      theme: { background: "#101418", foreground: "#e7ecf1", cursor: "#e7ecf1" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;
    const encoder = new TextEncoder();
    const dataSub = term.onData((data) => {
      const bytes = Array.from(encoder.encode(data));
      void invoke("write_terminal", { sessionId, data: bytes }).catch(() => undefined);
    });
    let disposed = false;
    const channel = new Channel<number[]>();
    channel.onmessage = (message) => {
      const bytes = message instanceof Uint8Array ? message : Uint8Array.from(message);
      term.write(bytes);
    };
    // A later folder change is a cd into the live shell, not a new pty.
    void invoke("open_terminal", { sessionId, cwd: folder, channel }).then(() => {
      if (disposed) return;
      fit.fit();
      void invoke("resize_terminal", {
        sessionId,
        cols: Math.max(1, term.cols),
        rows: Math.max(1, term.rows),
      }).catch(() => undefined);
      setError(null);
    }).catch((caught: unknown) => {
      if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
    });
    const stopExit = openSubscription(() =>
      listen<{ sessionId: string; code: number | null }>("pty-exit", (event) => {
        if (event.payload.sessionId !== sessionId) return;
        const code = event.payload.code;
        term.write(`\r\n\x1b[0mshell exited (${code ?? "no status"})\r\n`);
        onExitedRef.current();
      }),
    );
    return () => {
      disposed = true;
      dataSub.dispose();
      stopExit();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, attempt]);

  useEffect(() => {
    if (hidden) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    fit.fit();
    void invoke("resize_terminal", {
      sessionId,
      cols: Math.max(1, term.cols),
      rows: Math.max(1, term.rows),
    }).catch(() => undefined);
    term.focus();
  }, [hidden, width, focusToken, sessionId]);

  return (
    <section className={hidden ? "terminal-column hidden" : "terminal-column"} style={hidden ? undefined : { width }}>
      <header>
        <strong>Terminal</strong>
        <button type="button" className="control" onClick={onHide}>Hide</button>
        <button type="button" className="control" onClick={onKill}>Kill</button>
      </header>
      {error ? (
        <div className="terminal-error">
          <p>{error}</p>
          <button type="button" className="control" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </div>
      ) : null}
      <div ref={hostRef} className="terminal-host" />
    </section>
  );
}
