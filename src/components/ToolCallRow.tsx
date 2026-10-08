import { toolPresentation } from "../chat/tools";

export function ToolCallRow({ name, input, folder, done }: { name: string; input: unknown; folder: string; done: boolean }) {
  const view = toolPresentation(name, input, folder);
  return (
    <div className={done ? "tool-row" : "tool-row spinning"}>
      <span aria-hidden="true">{view.icon}</span>
      <code>{view.text}</code>
    </div>
  );
}
