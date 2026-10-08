export function toolPresentation(name: string, input: unknown, folder: string): { icon: string; text: string } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const path = stringField(record, ["path", "file_path", "target_file", "file"]);
  const pattern = stringField(record, ["pattern", "query"]);
  const command = stringField(record, ["command"]);
  const relative = path ? stripFolder(path, folder) : "";
  switch (name) {
    case "read_file":
    case "list_dir":
      return { icon: "📜", text: relative || name };
    case "grep":
      return { icon: "🔍", text: pattern || relative || name };
    case "search_replace":
    case "write":
      return { icon: "🖊️", text: relative || name };
    default: {
      const first = command || pattern || relative || firstString(record) || name;
      return { icon: "🔧", text: first };
    }
  }
}

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function firstString(record: Record<string, unknown>): string {
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function stripFolder(path: string, folder: string): string {
  if (!folder) return path;
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
