import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type Props = { text: string; onLink: (url: string) => void };

export function MarkdownView({ text, onLink }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        a: ({ href, children }) => {
          const url = href ?? "";
          if (!isSafeLink(url)) return <span>{children}</span>;
          return (
            <a href={url} onClick={(event) => { event.preventDefault(); onLink(url); }}>
              {children}
            </a>
          );
        },
        img: ({ alt, src }) => (
          <a href={src} onClick={(event) => { event.preventDefault(); if (src && isSafeLink(src)) onLink(src); }}>
            {alt || src || "image"}
          </a>
        ),
        code: ({ className, children }) => {
          if (!className) return <code>{children}</code>;
          return <CodeBlock className={className}>{children}</CodeBlock>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  return (
    <div className="code-block">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
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
