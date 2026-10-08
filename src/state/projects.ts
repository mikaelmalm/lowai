import type { Project } from "./types";

export function canDeleteProject(projects: Project[], projectId: string, sessionCount: number): boolean {
  return projects.length > 1 && sessionCount === 0;
}
