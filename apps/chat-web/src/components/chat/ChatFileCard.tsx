import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Image as ImageIcon, Maximize2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { refreshChatAttachmentUrl } from "@/lib/chatAttachments";
import { refreshArtifactFileUrl } from "@/lib/chatArtifacts";
import { getFileExtension, type ChatMessageFilePart } from "@/lib/chatMessageParts";
import { cn } from "@/lib/utils";
import { downloadChatFile } from "./chatFileDownloads";
import { isAllowedStreamFileUrl, isSafeRenderableImage, isSafeRenderableVideo } from "./chatStreamFileSafety";

type ChatFileCardProps = {
  part: ChatMessageFilePart;
  role: "user" | "assistant";
};

const normalizeSupabaseStorageUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/object/sign/")) {
      parsed.pathname = `/storage/v1${parsed.pathname}`;
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
};

const refreshFilePartUrl = (part: ChatMessageFilePart) => {
  if (part.artifactId) return refreshArtifactFileUrl(part);
  return refreshChatAttachmentUrl(part);
};

export function ChatFileCard({ part, role }: ChatFileCardProps) {
  const [activePart, setActivePart] = useState(part);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isUser = role === "user";
  const isImage = isSafeRenderableImage(activePart);
  const isVideo = isSafeRenderableVideo(activePart);
  const extension = getFileExtension(activePart.name || activePart.url);
  const displayUrl = normalizeSupabaseStorageUrl(activePart.url);

  useEffect(() => {
    setActivePart(part);
  }, [part]);

  const refreshActivePart = useCallback(async () => {
    const refreshedPart = await refreshFilePartUrl(activePart).catch(() => activePart);
    const nextPart = {
      ...refreshedPart,
      url: normalizeSupabaseStorageUrl(refreshedPart.url),
    };
    setActivePart(nextPart);
    return nextPart;
  }, [activePart]);

  useEffect(() => {
    if (!part.storagePath && !part.artifactId) return;

    let cancelled = false;
    refreshFilePartUrl(part)
      .then((refreshedPart) => {
        if (cancelled) return;
        setActivePart({
          ...refreshedPart,
          url: normalizeSupabaseStorageUrl(refreshedPart.url),
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [part]);

  const getActivePart = async () => {
    const refreshedPart = await refreshActivePart();
    const url = normalizeSupabaseStorageUrl(refreshedPart.url);
    if (!isAllowedStreamFileUrl(url)) {
      throw new Error("unsafe_file_url");
    }
    return {
      ...refreshedPart,
      url,
    };
  };

  const handleOpen = async () => {
    try {
      const active = await getActivePart();
      if (isImage) {
        setPreviewUrl(active.url);
        return;
      }
      window.open(active.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Não foi possível abrir o arquivo.");
    }
  };

  const handleDownload = async () => {
    try {
      const active = await getActivePart();
      await downloadChatFile({
        url: active.url,
        fileName: active.name,
      });
    } catch {
      toast.error("Não foi possível baixar o arquivo.");
    }
  };

  return (
    <>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border shadow-sm",
          isUser ? "border-white/20 bg-white/10" : "border-slate-200/70 bg-white/70",
        )}
      >
        {isImage ? (
          <button type="button" onClick={handleOpen} className="block w-full text-left" aria-label={`Ampliar ${activePart.name}`}>
            <div className={cn("overflow-hidden", isUser ? "bg-white/10" : "bg-slate-100/80")}>
              <img src={displayUrl} alt={activePart.name} className="max-h-[280px] w-full object-cover" />
            </div>
          </button>
        ) : null}

        {isVideo ? (
          <div className={cn("overflow-hidden", isUser ? "bg-white/10" : "bg-slate-950")}>
            <video src={displayUrl} controls preload="metadata" className="max-h-[320px] w-full bg-black object-contain" />
          </div>
        ) : null}

        <div className="flex items-center gap-3 p-3">
          <div
            className={cn(
              "grid h-12 w-12 shrink-0 place-items-center rounded-xl border",
              isUser ? "border-white/20 bg-white/10" : "border-slate-200 bg-white",
            )}
          >
            {isImage ? (
              <ImageIcon className={cn("h-5 w-5", isUser ? "text-white" : "text-slate-700")} />
            ) : (
              <FileText className={cn("h-5 w-5", isUser ? "text-white" : "text-slate-700")} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm font-medium", isUser ? "text-white" : "text-slate-900")}>{activePart.name}</p>
            <p className={cn("text-xs", isUser ? "text-white/80" : "text-slate-600")}>
              {isImage ? "Imagem" : isVideo ? "Video" : "Arquivo"}
              {extension ? ` • ${extension.toUpperCase()}` : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="icon" variant="ghost" className={cn("h-9 w-9 rounded-full", isUser ? "hover:bg-white/20" : "hover:bg-slate-100")} onClick={handleOpen} aria-label={isImage ? `Ampliar ${activePart.name}` : `Abrir ${activePart.name}`}>
              {isImage ? <Maximize2 className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
            </Button>

            <Button type="button" size="icon" variant="ghost" className={cn("h-9 w-9 rounded-full", isUser ? "hover:bg-white/20" : "hover:bg-slate-100")} onClick={handleDownload} aria-label={`Baixar ${activePart.name}`}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {isImage ? (
        <Dialog open={Boolean(previewUrl)} onOpenChange={(open) => !open && setPreviewUrl(null)}>
          <DialogContent className="w-[96vw] max-w-6xl border-white/20 bg-white/95 p-0 text-slate-900 shadow-2xl backdrop-blur-xl">
            <DialogHeader className="border-b border-slate-200/80 px-6 py-4">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0 space-y-1">
                  <DialogTitle className="truncate">{activePart.name}</DialogTitle>
                  <DialogDescription>Visualização ampliada da imagem gerada.</DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="mr-2 h-4 w-4" />
                    Baixar
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div className="flex max-h-[78vh] items-center justify-center overflow-auto bg-slate-950/95 p-4">
              {previewUrl ? (
                <img src={previewUrl} alt={activePart.name} className="max-h-[72vh] max-w-full rounded-lg object-contain shadow-2xl" />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
