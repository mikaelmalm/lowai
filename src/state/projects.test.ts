import { describe, expect, it } from "vitest";
import { canDeleteProject } from "./projects";

describe("canDeleteProject", () => {
  const projects = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

  it("deletes only an empty project, and never the last one", () => {
    expect(canDeleteProject(projects, "a", 0)).toBe(true);
    expect(canDeleteProject(projects, "a", 2)).toBe(false);
    expect(canDeleteProject([{ id: "a", name: "A" }], "a", 0)).toBe(false);
  });
});
