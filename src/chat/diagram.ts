import type mermaid from "mermaid";
import type { Theme } from "../state/types";

export function isMermaid(className: string | undefined): boolean {
  return className?.split(/\s+/).includes("language-mermaid") ?? false;
}

let loading: Promise<typeof mermaid> | null = null;

function load(): Promise<typeof mermaid> {
  loading ??= import("mermaid").then((mod) => mod.default);
  return loading;
}

function configure(api: typeof mermaid, theme: Theme) {
  const light = theme === "light";
  api.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: light ? "default" : "dark",
    fontFamily: '"Inter Variable", sans-serif',
    themeVariables: light
      ? {
          darkMode: false,
          background: "#ffffff",
          primaryColor: "#e7edf2",
          primaryTextColor: "#1c242c",
          primaryBorderColor: "#d3dde6",
          secondaryColor: "#f3f5f7",
          tertiaryColor: "#f3f5f7",
          lineColor: "#5c6c7a",
          textColor: "#1c242c",
          mainBkg: "#e7edf2",
          nodeBorder: "#5c6c7a",
          clusterBkg: "#f3f5f7",
          titleColor: "#1c242c",
          edgeLabelBackground: "#ffffff",
          noteBkgColor: "#f8ecdc",
          noteTextColor: "#8f4e12",
        }
      : {
          darkMode: true,
          background: "#1b2128",
          primaryColor: "#2a3038",
          primaryTextColor: "#e7ecf1",
          primaryBorderColor: "#3a424c",
          secondaryColor: "#2c343d",
          tertiaryColor: "#101418",
          lineColor: "#9aa6b2",
          textColor: "#e7ecf1",
          mainBkg: "#2a3038",
          nodeBorder: "#9aa6b2",
          clusterBkg: "#1b2128",
          titleColor: "#e7ecf1",
          edgeLabelBackground: "#1b2128",
          noteBkgColor: "#3a2a1a",
          noteTextColor: "#f0c6a0",
        },
  });
}

function detachTemp(id: string) {
  for (const nodeId of [id, `d${id}`]) {
    const node = document.getElementById(nodeId);
    if (node?.parentElement === document.body) node.remove();
  }
}

export async function drawDiagram(source: string, id: string, theme: Theme = "dark"): Promise<string | null> {
  const trimmed = source.trim();
  if (!trimmed) return null;
  const api = await load();
  configure(api, theme);
  const parsed = await api.parse(trimmed, { suppressErrors: true });
  if (parsed === false) return null;
  try {
    const { svg } = await api.render(id, trimmed);
    if (/<script|javascript:/i.test(svg)) return null;
    return svg;
  } catch {
    return null;
  } finally {
    detachTemp(id);
  }
}
