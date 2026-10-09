import type { Project } from "./types";

export function canDeleteProject(projects: Project[], projectId: string, sessionCount: number): boolean {
  return projects.length > 1 && sessionCount === 0;
}

export function nextProjectName(projects: Project[]): string {
  const names = new Set(projects.map((project) => project.name));
  if (!names.has("Project")) return "Project";
  let n = 2;
  while (names.has(`Project ${n}`)) n += 1;
  return `Project ${n}`;
}
