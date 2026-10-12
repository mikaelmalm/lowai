import { toolPresentation } from "../chat/tools";
import { toolOpenPath } from "../preview/rules";

export function ToolCallRow({ name, input, folder, done, onOpen }: { name: string; input: unknown; folder: string; done: boolean; onOpen?: (path: string) => void }) {
  const view = toolPresentation(name, input, folder);
  const path = onOpen ? toolOpenPath(name, input, folder) : null;
  const className = done ? "tool-row" : "tool-row spinning";
  const body = (
    <>
      <span aria-hidden="true">{view.icon}</span>
      <code>{view.text}</code>
    </>
  );
  if (path && onOpen) {
    return <button type="button" className={className} onClick={() => onOpen(path)}>{body}</button>;
  }
  return <div className={className}>{body}</div>;
}
