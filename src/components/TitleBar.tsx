import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const win = getCurrentWindow();
  useEffect(() => {
    let stopped = false;
    const mark = (maximized: boolean) => document.documentElement.classList.toggle("maximized", maximized);
    void win.isMaximized().then((maximized) => { if (!stopped) mark(maximized); });
    const listen = win.onResized(() => {
      void win.isMaximized().then((maximized) => { if (!stopped) mark(maximized); });
    });
    return () => {
      stopped = true;
      void listen.then((unlisten) => unlisten());
    };
  }, []);
  return (
    <header
      className="titlebar"
      onMouseDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        if (event.detail === 2) void win.toggleMaximize();
        else void win.startDragging();
      }}
    >
      <span>lowai</span>
      <div className="titlebar-controls">
        <button type="button" aria-label="Minimize" onClick={() => void win.minimize()}>−</button>
        <button type="button" aria-label="Maximize" onClick={() => void win.toggleMaximize()}>□</button>
        <button type="button" className="close" aria-label="Close" onClick={() => void win.close()}>×</button>
      </div>
    </header>
  );
}
