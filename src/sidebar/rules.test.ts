import { describe, expect, it } from "vitest";
import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, sidebarShortcut } from "./rules";

const ctrlB = { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: "b" };

describe("sidebar rules", () => {
  it("clamps the sidebar so the chat keeps 320 pixels", () => {
    expect(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, 1400, 0)).toBe(280);
    expect(clampSidebarWidth(900, 1400, 480)).toBe(600);
    expect(clampSidebarWidth(100, 1400, 0)).toBe(180);
    expect(clampSidebarWidth(Number.NaN, 1400, 0)).toBe(280);
    expect(clampSidebarWidth(400, 500, 200)).toBe(180);
  });

  it("toggles on ctrl+b unless the terminal is focused", () => {
    expect(sidebarShortcut(ctrlB, false)).toBe(true);
    expect(sidebarShortcut(ctrlB, true)).toBe(false);
    expect(sidebarShortcut({ ...ctrlB, key: "a" }, false)).toBe(false);
    expect(sidebarShortcut({ ...ctrlB, shiftKey: true }, false)).toBe(false);
  });
});