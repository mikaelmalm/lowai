export function permissionView(name: string, input: unknown): { name: string; detail: string } {
  const label = name.trim() || "tool";
  let detail = "";
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const command = record.command ?? record.cmd ?? record.path ?? record.file_path;
    if (typeof command === "string" && command.trim()) detail = command.trim();
  }
  if (!detail && input != null) {
    try {
      detail = JSON.stringify(input);
    } catch {
      detail = "";
    }
  }
  if (detail.length > 180) detail = `${detail.slice(0, 177)}...`;
  return { name: label, detail };
}
