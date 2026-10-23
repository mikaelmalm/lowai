import { toolDetail, toolPresentation } from "../chat/tools";
import { toolOpenPath } from "../preview/rules";
import type { Theme } from "../state/types";
import { MarkdownView } from "./MarkdownView";

export function ToolCallRow({
  name,
  input,
  folder,
  done,
  onOpen,
  theme,
  onLink,
}: {
  name: string;
  input: unknown;
  folder: string;
  done: boolean;
  onOpen?: (path: string) => void;
  theme: Theme;
  onLink: (url: string) => void;
}) {
  const view = toolPresentation(name, input, folder);
  const detail = toolDetail(view.text);
  const path = onOpen ? toolOpenPath(name, input, folder) : null;
  const className = done ? "tool-row" : "tool-row spinning";
  const icon = <span aria-hidden="true">{view.icon}</span>;
  if (detail.long) {
    return (
      <details className={`${className} tool-fold`}>
        <summary>
          <span className="tool-line">
            {icon}
            <code>{detail.preview}</code>
          </span>
        </summary>
        <div className="tool-body">
          {detail.markdown ? (
            <MarkdownView text={view.text} theme={theme} onLink={onLink} onOpenPath={onOpen} />
          ) : (
            <pre>{view.text}</pre>
          )}
        </div>
      </details>
    );
  }
  const body = detail.markdown ? (
    <>
      {icon}
      <div className="tool-markdown">
        <MarkdownView text={view.text} theme={theme} onLink={onLink} onOpenPath={onOpen} />
      </div>
    </>
  ) : (
    <>
      {icon}
      <code>{view.text}</code>
    </>
  );
  if (path && onOpen) {
    return <button type="button" className={className} onClick={() => onOpen(path)}>{body}</button>;
  }
  return <div className={className}>{body}</div>;
}
