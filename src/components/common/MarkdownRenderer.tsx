import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import { CopyIcon, CheckIcon } from "@/components/common/Icons";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-bold text-text-primary mt-4 mb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-text-primary mt-3 mb-2 pb-1 border-b border-border">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-text-primary mt-2 mb-1">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-text-secondary mb-2 leading-relaxed text-sm">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside text-text-secondary mb-2 space-y-0.5 text-sm">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside text-text-secondary mb-2 space-y-0.5 text-sm">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="text-sm">{children}</li>,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return <CodeBlock>{children}</CodeBlock>;
            }
            return (
              <code className="bg-bg-elevated px-1 py-0.5 rounded text-xs font-mono text-text-primary">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          strong: ({ children }) => (
            <strong className="text-text-primary font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="text-text-primary">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border-strong pl-3 my-2 text-text-secondary italic">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <table className="w-full my-2 border-collapse text-xs">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left text-text-primary font-semibold bg-bg-elevated">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 text-text-secondary">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Fenced code block with a copy-to-clipboard affordance. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // Extract text content from the React nodes.
      const text = extractText(children);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("[aigit] copy failed:", e);
    }
  };

  return (
    <div className="relative group my-2">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-bg-elevated border border-border text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Copy code"
      >
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      </button>
      <pre className="bg-bg-base border border-border rounded p-3 overflow-auto">
        <code className="text-xs font-mono text-text-primary">{children}</code>
      </pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return "";
}

