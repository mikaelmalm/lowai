import { useEffect, useState } from "react";
import { drawDiagram } from "../chat/diagram";
import type { Theme } from "../state/types";

export function MermaidBlock({ source, theme }: { source: string; theme: Theme }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd${crypto.randomUUID().replaceAll("-", "")}`;
    setSvg(null);
    void drawDiagram(source, id, theme).then((next) => {
      if (!cancelled) setSvg(next);
    });
    return () => {
      cancelled = true;
    };
  }, [source, theme]);

  function copy() {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  if (!svg) {
    return (
      <div className="code-block">
        <button type="button" className="control" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
        <pre><code>{source}</code></pre>
      </div>
    );
  }

  return (
    <figure className="diagram-block">
      <button type="button" className="control" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      <div className="diagram-frame" dangerouslySetInnerHTML={{ __html: svg }} />
      <details>
        <summary>Source</summary>
        <pre><code>{source}</code></pre>
      </details>
    </figure>
  );
}
