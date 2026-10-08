export const AGENT_ORDER = ["grok", "agy", "claude"] as const;
export type AgentId = (typeof AGENT_ORDER)[number];

const MODELS: Record<AgentId, readonly string[]> = {
  grok: ["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5"],
  agy: [
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.7-flash-high",
    "gemini-3.7-flash-medium",
    "gemini-3.7-flash-low",
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium",
  ],
  claude: ["sonnet", "opus", "haiku"],
};

export function isAgent(value: unknown): value is AgentId {
  return value === "grok" || value === "agy" || value === "claude";
}

export function savedAgent(value: unknown): AgentId {
  if (value === "gemini") return "agy";
  return isAgent(value) ? value : "grok";
}

export function modelsFor(agent: string): readonly string[] {
  return isAgent(agent) ? MODELS[agent] : MODELS.grok;
}

export function defaultModel(agent: string): string {
  return modelsFor(agent)[0];
}

export function savedModel(agent: string, model: unknown): string {
  const models = modelsFor(agent);
  return typeof model === "string" && models.includes(model) ? model : defaultModel(agent);
}

export function selectedFrom(saved: string, available: readonly string[]): string {
  if (available.includes(saved)) return saved;
  return available[0] ?? "";
}
