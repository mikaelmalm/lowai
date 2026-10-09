import { isValidElement, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { isMermaid } from "../chat/diagram";
import type { Theme } from "../state/types";
import { MermaidBlock } from "./MermaidBlock";

type Props = { text: string; theme: Theme; onLink: (url: string) => void };

export function MarkdownView({ text, theme, onLink }: Props) {
  const onLinkRef = useRef(onLink);
  onLinkRef.current = onLink;
  const components = useMemo(() => ({
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const url = href ?? "";
      if (!isSafeLink(url)) return <span>{children}</span>;
      return (
        <a href={url} onClick={(event) => { event.preventDefault(); onLinkRef.current(url); }}>
          {children}
        </a>
      );
    },
    img: ({ alt, src }: { alt?: string; src?: string }) => (
      <a href={src} onClick={(event) => { event.preventDefault(); if (src && isSafeLink(src)) onLinkRef.current(src); }}>
        {alt || src || "image"}
      </a>
    ),
    code: ({ className, children }: { className?: string; children?: ReactNode }) => {
      const source = textContent(children).replace(/\n$/, "");
      if (isMermaid(className)) return <MermaidBlock source={source} theme={theme} />;
      if (!className) return <code>{children}</code>;
      return <CodeBlock className={className} source={source}>{children}</CodeBlock>;
    },
  }), [theme]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}

function textContent(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) return textContent(children.props.children);
  return "";
}

function CodeBlock({ className, source, children }: { className?: string; source: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <button
        type="button"
        className="control"
        onClick={() => {
          void navigator.clipboard.writeText(source).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function isSafeLink(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:");
}
