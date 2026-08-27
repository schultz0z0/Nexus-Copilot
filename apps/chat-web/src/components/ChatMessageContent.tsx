import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileCode2, FileText, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ChatCodeBlock } from "@/components/chat/ChatCodeBlock";
import { ChatContentPreviewDialog } from "@/components/chat/ChatContentPreviewDialog";
import { ChatFileCard } from "@/components/chat/ChatFileCard";
import {
  createRenderableImagePreviewPartFromUrl,
  extractRenderableImagePreviewsFromParts,
} from "@/components/chat/chatTextImagePreviews";
import {
  shouldHideTextImagePreview,
} from "@/lib/chatAttachments";
import {
  parseChatMessageContent,
  type ChatMessageArtifactPart,
  type ChatMessagePart,
  type ChatMessageStatusPart,
  type ChatMessageTextPart,
} from "@/lib/chatMessageParts";
import { cn } from "@/lib/utils";
import { parseMarketingOpsDeepLink } from "@/lib/marketingOps/deepLinks";
import { getTextRenderMode, shouldExtractTextImagePreviews } from "./chat/chatMessageRendering";

type ChatMessageContentProps = {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
};

export const ChatMessageContent = memo(function ChatMessageContent({ role, content, isStreaming = false }: ChatMessageContentProps) {
  const [previewArtifact, setPreviewArtifact] = useState<ChatMessageArtifactPart | null>(null);
  const parts = useMemo(() => parseChatMessageContent(content), [content]);
  const hasStructuredImagePart = useMemo(
    () => parts.some((part) => part.type === "file" && part.kind === "image"),
    [parts],
  );
  const textImagePreviews = useMemo(
    () =>
      shouldExtractTextImagePreviews({ role, isStreaming })
        ? extractRenderableImagePreviewsFromParts(parts).filter(
            (preview) => !shouldHideTextImagePreview({ textUrl: preview.url, hasStructuredImagePart }),
          )
        : [],
    [hasStructuredImagePart, isStreaming, parts, role],
  );

  const getTextContainerClassName = () =>
    cn(
      "prose prose-sm max-w-none break-words",
      role === "user" && "prose-invert prose-a:text-white prose-a:underline",
      role === "assistant" && "dark:prose-invert",
    );

  const renderTextPart = (part: ChatMessageTextPart) => {
    const renderMode = getTextRenderMode({
      role,
      isStreaming,
      textLength: part.text.length,
    });

    if (renderMode === "plain") {
      return (
        <div key={part.id} className={getTextContainerClassName()}>
          <pre className="mb-2 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed last:mb-0">
            {part.text}
          </pre>
        </div>
      );
    }

    return (
      <div
        key={part.id}
        className={getTextContainerClassName()}
      >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ul: ({ node, ...props }) => <ul className="my-2 list-disc pl-4" {...props} />,
          ol: ({ node, ...props }) => <ol className="my-2 list-decimal pl-4" {...props} />,
          li: ({ node, ...props }) => <li className="mb-1" {...props} />,
          p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
          table: ({ node, ...props }) => (
            <div className="my-3 overflow-x-auto rounded-2xl border border-slate-200/70">
              <table className="min-w-full border-collapse text-left text-xs" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => <thead className="bg-slate-100/80 text-slate-700" {...props} />,
          tbody: ({ node, ...props }) => <tbody className="divide-y divide-slate-200/70 bg-white/70" {...props} />,
          tr: ({ node, ...props }) => <tr className="divide-x divide-slate-200/70" {...props} />,
          th: ({ node, ...props }) => <th className="px-3 py-2 font-semibold" {...props} />,
          td: ({ node, ...props }) => <td className="px-3 py-2 align-top" {...props} />,
          strong: ({ node, ...props }) => (
            <strong className={cn("font-bold", role === "assistant" ? "text-brand-primary" : "text-white")} {...props} />
          ),
          a: ({ node, href, children, ...props }) => {
            const className = cn(
              role === "assistant" ? "text-brand-primary hover:underline" : "text-white underline",
            );
            if (typeof href === "string" && href.startsWith("/marketing-ops/")) {
              if (!parseMarketingOpsDeepLink(href)) {
                return <span className={className}>{children}</span>;
              }
              return <Link className={className} to={href}>{children}</Link>;
            }
            return (
              <a
                className={className}
                href={href}
                {...props}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
          img: ({ node, src, alt, ...props }) => {
            if (
              typeof src === "string" &&
              shouldHideTextImagePreview({
                textUrl: src,
                hasStructuredImagePart,
              })
            ) {
              return null;
            }

            const preview = typeof src === "string" ? createRenderableImagePreviewPartFromUrl(src) : null;
            if (!preview) return null;

            return (
              <img
                className={cn("my-2 max-w-full rounded-xl border", role === "user" ? "border-white/20" : "border-slate-200/60")}
                src={preview.url}
                alt={alt ?? preview.name}
                {...props}
              />
            );
          },
          code: ({ node, className, children, ...props }) => {
            const value = String(children ?? "").replace(/\n$/, "");
            const language = className?.replace("language-", "").trim();
            const isInline = !className && !value.includes("\n");

            if (isInline) {
              return (
                <code
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[0.9em]",
                    role === "user" ? "bg-white/15 text-white" : "bg-slate-200/70 text-slate-900",
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return <ChatCodeBlock code={value} language={language} />;
          },
          pre: ({ node, children }) => <>{children}</>,
        }}
      >
        {part.text}
      </ReactMarkdown>
    </div>
    );
  };

  const renderStatusPart = (part: ChatMessageStatusPart) => {
    const toneClassName =
      part.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : part.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-sky-200 bg-sky-50 text-sky-700";

    return (
      <div
        key={part.id}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
          toneClassName,
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span>{part.text}</span>
      </div>
    );
  };

  const renderArtifactPart = (part: ChatMessageArtifactPart) => {
    const isMarkdown = part.artifactType === "markdown";
    const label = isMarkdown ? "Documento" : part.artifactType === "html" ? "Artifact HTML" : "Artifact";

    return (
      <div key={part.id} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              {isMarkdown ? <FileText className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />}
              <span>{part.title}</span>
            </div>
            <p className="text-xs text-slate-600">
              {label}
              {part.language ? ` • ${part.language}` : ""}
            </p>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={() => setPreviewArtifact(part)}>
            Abrir
          </Button>
        </div>

        <div className="mt-3 rounded-xl bg-slate-950/95 p-3 text-xs text-slate-100">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
            <code>{part.content}</code>
          </pre>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-3 text-sm leading-relaxed">
        {parts.map((part: ChatMessagePart) => {
          if (part.type === "text") return renderTextPart(part);
          if (part.type === "file") return <ChatFileCard key={part.id} part={part} role={role} />;
          if (part.type === "artifact") return renderArtifactPart(part);
          if (part.type === "status") return renderStatusPart(part);
          return null;
        })}

        {textImagePreviews.map((part) => (
          <ChatFileCard key={`text-image-preview-${part.url}`} part={part} role={role} />
        ))}

        {isStreaming && (
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-950/5 px-2 py-1 text-xs text-text-muted">
            <span className="inline-block h-4 w-1.5 animate-pulse rounded-full bg-brand-primary" aria-hidden="true" />
            <span>Hermes digitando...</span>
          </div>
        )}
      </div>

      {previewArtifact ? (
        <ChatContentPreviewDialog
          open={Boolean(previewArtifact)}
          onOpenChange={(open) => {
            if (!open) setPreviewArtifact(null);
          }}
          title={previewArtifact.title}
          description="Visualização ampliada do artefato gerado pelo Hermes."
          content={previewArtifact.content}
          mode={previewArtifact.artifactType === "markdown" ? "markdown" : previewArtifact.artifactType === "html" ? "html" : previewArtifact.artifactType === "code" ? "code" : "text"}
          language={previewArtifact.language}
          fileName={previewArtifact.fileName}
        />
      ) : null}
    </>
  );
});

ChatMessageContent.displayName = "ChatMessageContent";

