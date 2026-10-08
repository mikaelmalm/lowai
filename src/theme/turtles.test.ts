import { describe, expect, it } from "vitest";
import { assignTurtle, readableOn, TURTLES } from "./turtles";

describe("assignTurtle", () => {
  it("picks the first free turtle in the project", () => {
    expect(assignTurtle(["Leonardo", "Raphael"]).name).toBe("Donatello");
  });

  it("keeps session colors readable", () => {
    for (const turtle of TURTLES) {
      const pair = readableOn(turtle.color);
      const fg = Number.parseInt(pair.color.slice(1), 16);
      const bg = Number.parseInt(pair.background.slice(1), 16);
      const lum = (value: number) => {
        const channel = (shift: number) => {
          const raw = ((value >> shift) & 255) / 255;
          return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
      };
      const lighter = Math.max(lum(fg), lum(bg));
      const darker = Math.min(lum(fg), lum(bg));
      expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("cycles after every turtle is taken", () => {
    const used = ["Leonardo", "Raphael", "Donatello", "Michelangelo", "Splinter", "April", "Casey"];
    expect(assignTurtle(used).name).toBe("Leonardo");
  });
});
