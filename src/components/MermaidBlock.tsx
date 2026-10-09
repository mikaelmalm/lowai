import { useEffect, useState } from "react";
import { drawDiagram, heldDiagram, keepDrawnSvg } from "../chat/diagram";
import type { Theme } from "../state/types";

export function MermaidBlock({ source, theme }: { source: string; theme: Theme }) {
  const [svg, setSvg] = useState<string | null>(() => heldDiagram(null, source, theme));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSvg((current) => heldDiagram(current, source, theme));
    if (heldDiagram(null, source, theme)) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const id = `mmd${crypto.randomUUID().replaceAll("-", "")}`;
      void drawDiagram(source, id, theme).then((next) => {
        if (!cancelled) setSvg((current) => keepDrawnSvg(current, next));
      });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [source, theme]);

  function copy() {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <figure className="diagram-block">
      <button type="button" className="control" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      {svg ? (
        <div className="diagram-frame" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre><code>{source}</code></pre>
      )}
      {svg ? (
        <details>
          <summary>Source</summary>
          <pre><code>{source}</code></pre>
        </details>
      ) : null}
    </figure>
  );
}
