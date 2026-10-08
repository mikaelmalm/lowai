import { describe, expect, it } from "vitest";
import { assignTurtle } from "./turtles";

describe("assignTurtle", () => {
  it("picks the first free turtle in the project", () => {
    expect(assignTurtle(["Leonardo", "Raphael"]).name).toBe("Donatello");
  });

  it("cycles after every turtle is taken", () => {
    const used = ["Leonardo", "Raphael", "Donatello", "Michelangelo", "Splinter", "April", "Casey"];
    expect(assignTurtle(used).name).toBe("Leonardo");
  });
});
