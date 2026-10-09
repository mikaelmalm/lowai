import { describe, expect, it } from "vitest";
import { afterExit, afterHide, afterKill, clampTerminalWidth, DEFAULT_TERMINAL_WIDTH, openAction, routeBytes, shellCd, terminalPalette } from "./rules";

describe("terminal rules", () => {
  it("picks light paper without reading styles from a hidden pane", () => {
    expect(terminalPalette("light").background).toBe("#f3f5f7");
    expect(terminalPalette("light").foreground).toBe("#1c242c");
    expect(terminalPalette("dark").background).toBe("#101418");
    expect(terminalPalette("dark").foreground).toBe("#e7ecf1");
  });

  it("spawns when no shell is alive and shows a live one", () => {
    expect(openAction(false, false)).toBe("spawn");
    expect(openAction(true, false)).toBe("show");
  });

  it("spawns again after the shell has exited", () => {
    expect(afterExit()).toEqual({ alive: false, exited: true });
    expect(openAction(false, true)).toBe("spawn");
  });

  it("delivers bytes only to the owning session", () => {
    const chunk = Uint8Array.from([0xff, 0x68, 0x69]);
    expect(routeBytes("s1", "s1", chunk)).toBe(chunk);
    expect(routeBytes("s1", "s2", chunk)).toBeNull();
  });

  it("hides without killing and kill requests a close", () => {
    expect(afterHide(true)).toEqual({ visible: false, alive: true });
    expect(afterKill()).toEqual({ visible: false, alive: false, close: true });
  });

  it("quotes a directory change for the shell", () => {
    expect(shellCd("/work/my app", "linux")).toBe(`cd -- '/work/my app'\n`);
    expect(shellCd("/tmp/a'b", "linux")).toBe(`cd -- '/tmp/a'\\''b'\n`);
    expect(shellCd("C:\\work\\app", "Win32")).toBe(`Set-Location -LiteralPath 'C:\\work\\app'\r`);
  });

  it("clamps the pane between the chat and the terminal minimums", () => {
    expect(clampTerminalWidth(DEFAULT_TERMINAL_WIDTH, 1200)).toBe(480);
    expect(clampTerminalWidth(900, 1000)).toBe(680);
    expect(clampTerminalWidth(100, 1200)).toBe(240);
    expect(clampTerminalWidth(Number.NaN, 1200)).toBe(480);
  });
});
