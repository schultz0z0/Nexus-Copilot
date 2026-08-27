import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ChatContentPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  content: string;
  mode: "code" | "markdown" | "text" | "html";
  language?: string;
  fileName?: string;
};

const downloadTextFile = (fileName: string, content: string, mimeType = "text/plain;charset=utf-8") => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export function ChatContentPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  content,
  mode,
  language,
  fileName,
}: ChatContentPreviewDialogProps) {
  const downloadName = useMemo(() => {
    if (fileName?.trim()) return fileName;
    if (mode === "markdown") return "resposta.md";
    if (mode === "html") return "artifact.html";
    if (mode === "code") return `snippet.${language || "txt"}`;
    return "conteudo.txt";
  }, [fileName, language, mode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Conteúdo copiado");
    } catch {
      toast.error("Não foi possível copiar o conteúdo.");
    }
  };

  const handleDownload = () => {
    const mimeType =
      mode === "markdown"
        ? "text/markdown;charset=utf-8"
        : mode === "html"
          ? "text/html;charset=utf-8"
          : "text/plain;charset=utf-8";
    downloadTextFile(downloadName, content, mimeType);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-5xl border-white/20 bg-white/95 p-0 text-slate-900 shadow-2xl backdrop-blur-xl">
        <DialogHeader className="border-b border-slate-200/80 px-6 py-4">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Baixar
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="h-[78vh]">
          <div className="px-6 py-5">
            {mode === "markdown" ? (
              <div className="prose prose-sm max-w-none prose-pre:hidden">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            ) : mode === "html" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <iframe
                    title={title}
                    sandbox=""
                    srcDoc={content}
                    className="h-[60vh] w-full rounded-xl border border-slate-200 bg-white"
                  />
                </div>
                <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">
                  <code>{content}</code>
                </pre>
              </div>
            ) : (
              <pre
                className={cn(
                  "overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100",
                  mode === "text" && "whitespace-pre-wrap break-words",
                )}
              >
                <code>{content}</code>
              </pre>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
