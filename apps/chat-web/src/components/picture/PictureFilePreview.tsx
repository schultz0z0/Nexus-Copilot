import { Download, FileQuestion, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { PictureWorkspaceFile } from "@/lib/pictureWorkspace/types";

export type ResolvePictureAccessUrl = (
  file: PictureWorkspaceFile,
  forceRefresh?: boolean,
) => Promise<{ url: string; expiresAt: string }>;

interface PictureFilePreviewProps {
  file: PictureWorkspaceFile | null;
  resolveAccessUrl: ResolvePictureAccessUrl;
}

const isText = (file: PictureWorkspaceFile) =>
  file.content_type.startsWith("text/") || file.content_type === "application/json" || /\.(json|txt|md|css|js)$/i.test(file.filename);

export const PictureFilePreview = ({ file, resolveAccessUrl }: PictureFilePreviewProps) => {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl("");
    setText("");
    setError(null);
    if (!file) return () => { active = false; };

    const load = async () => {
      setLoading(true);
      try {
        let access = await resolveAccessUrl(file);
        if (Date.parse(access.expiresAt) <= Date.now() + 5_000) {
          access = await resolveAccessUrl(file, true);
        }
        if (!active) return;
        setUrl(access.url);
        if (isText(file)) {
          const response = await fetch(access.url, { headers: { Accept: file.content_type } });
          if (!response.ok) throw new Error("preview_fetch_failed");
          const raw = await response.text();
          if (!active) return;
          if (file.content_type === "application/json" || file.filename.toLowerCase().endsWith(".json")) {
            try { setText(JSON.stringify(JSON.parse(raw), null, 2)); } catch { setText(raw); }
          } else {
            setText(raw);
          }
        }
      } catch {
        if (active) setError("Não foi possível abrir este arquivo agora.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [file, resolveAccessUrl]);

  const refreshImage = async () => {
    if (!file) return;
    try {
      const access = await resolveAccessUrl(file, true);
      setUrl(access.url);
    } catch {
      setError("O link expirou e não pôde ser renovado.");
    }
  };

  if (!file) return <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-slate-500">Selecione um arquivo para visualizar.</div>;
  if (loading) return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Preparando visualização...</div>;
  if (error) return <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm text-red-600">{error}</div>;
  if (file.content_type.startsWith("image/") && url) {
    return <img src={url} alt={file.filename} onError={() => void refreshImage()} className="max-h-[54vh] w-full rounded-xl bg-slate-100 object-contain" />;
  }
  if (isText(file)) return <pre className="max-h-[54vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{text}</pre>;
  if (url) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
        <FileQuestion className="h-8 w-8 text-slate-400" />
        <p className="text-sm text-slate-600">Prévia não disponível para {file.content_type}.</p>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-brand-primary hover:underline">
          <Download className="h-4 w-4" />Abrir arquivo
        </a>
      </div>
    );
  }
  return null;
};
