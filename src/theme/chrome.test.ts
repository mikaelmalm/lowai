import { describe, expect, it } from "vitest";
import { fullscreenKeepsRoundedCorners } from "./chrome";

describe("fullscreen window corners", () => {
  it("keeps rounded corners on macOS and squares them elsewhere", () => {
    expect(fullscreenKeepsRoundedCorners("MacIntel")).toBe(true);
    expect(fullscreenKeepsRoundedCorners("MacArm")).toBe(true);
    expect(fullscreenKeepsRoundedCorners("Win32")).toBe(false);
    expect(fullscreenKeepsRoundedCorners("Linux x86_64")).toBe(false);
  });
});
