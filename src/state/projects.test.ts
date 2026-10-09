import { describe, expect, it } from "vitest";
import { canDeleteProject, nextProjectName } from "./projects";

describe("canDeleteProject", () => {
  const projects = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

  it("deletes only an empty project, and never the last one", () => {
    expect(canDeleteProject(projects, "a", 0)).toBe(true);
    expect(canDeleteProject(projects, "a", 2)).toBe(false);
    expect(canDeleteProject([{ id: "a", name: "A" }], "a", 0)).toBe(false);
  });
});

describe("nextProjectName", () => {
  it("uses Project, then Project 2, skipping names already taken", () => {
    expect(nextProjectName([{ id: "p", name: "Personal" }])).toBe("Project");
    expect(nextProjectName([{ id: "p", name: "Project" }])).toBe("Project 2");
    expect(nextProjectName([{ id: "a", name: "Project" }, { id: "b", name: "Project 2" }])).toBe("Project 3");
  });
});
