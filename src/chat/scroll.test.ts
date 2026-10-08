import { describe, expect, it } from "vitest";
import { isAtBottom } from "./scroll";

describe("isAtBottom", () => {
  it("stays with the latest line when the view is already there", () => {
    expect(isAtBottom(200, 500, 300)).toBe(true);
    expect(isAtBottom(180, 500, 300)).toBe(true);
  });

  it("lets a reader stay up in the history", () => {
    expect(isAtBottom(0, 500, 300)).toBe(false);
  });
});
