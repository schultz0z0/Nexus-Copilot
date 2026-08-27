import { useMemo, useState } from "react";
import { Check, Copy, Expand, FileCode2, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ChatContentPreviewDialog } from "@/components/chat/ChatContentPreviewDialog";
import { cn } from "@/lib/utils";

type ChatCodeBlockProps = {
  code: string;
  language?: string;
};

const normalizeLanguage = (language?: string) => {
  const normalized = (language ?? "").trim().toLowerCase();
  if (normalized === "md") return "markdown";
  if (normalized === "tsx") return "tsx";
  return normalized || "text";
};

export function ChatCodeBlock({ code, language }: ChatCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const normalizedLanguage = useMemo(() => normalizeLanguage(language), [language]);

  const previewMode = normalizedLanguage === "markdown" ? "markdown" : "code";
  const fileName = normalizedLanguage === "markdown" ? "resposta.md" : `snippet.${normalizedLanguage}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Código copiado");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar o código.");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="my-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900/90 px-4 py-2 text-xs text-slate-300">
          <div className="flex items-center gap-2 font-medium">
            <FileCode2 className="h-4 w-4" />
            <span>{normalizedLanguage}</span>
          </div>

          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white" onClick={handleCopy} aria-label="Copiar bloco de código">
              {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white" onClick={handleDownload} aria-label="Baixar bloco de código">
              <Download className="mr-1 h-4 w-4" />
              Baixar
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => setIsExpanded(true)} aria-label="Abrir bloco de código em tela ampliada">
              <Expand className="mr-1 h-4 w-4" />
              Abrir
            </Button>
          </div>
        </div>

        <pre className={cn("max-h-[420px] overflow-auto p-4 text-xs leading-6 text-slate-100", previewMode === "markdown" && "whitespace-pre-wrap break-words")}>
          <code>{code}</code>
        </pre>
      </div>

      <ChatContentPreviewDialog
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={previewMode === "markdown" ? "Documento Markdown" : "Bloco de Código"}
        description={previewMode === "markdown" ? "Visualização ampliada do conteúdo em Markdown." : `Código em ${normalizedLanguage}.`}
        content={code}
        mode={previewMode}
        language={normalizedLanguage}
        fileName={fileName}
      />
    </>
  );
}
