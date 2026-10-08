import { describe, expect, it } from "vitest";
import { afterExit, afterHide, afterKill, clampTerminalWidth, DEFAULT_TERMINAL_WIDTH, openAction, routeBytes } from "./rules";

describe("terminal rules", () => {
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

  it("clamps the pane between the chat and the terminal minimums", () => {
    expect(clampTerminalWidth(DEFAULT_TERMINAL_WIDTH, 1200)).toBe(480);
    expect(clampTerminalWidth(900, 1000)).toBe(680);
    expect(clampTerminalWidth(100, 1200)).toBe(240);
    expect(clampTerminalWidth(Number.NaN, 1200)).toBe(480);
  });
});
