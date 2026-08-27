import { Download, Expand, ImageOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ValidatedWork } from "@/lib/validatedWorks";

interface ValidatedVisualWorkCardProps {
  work: ValidatedWork;
  bridgeBaseUrl: string;
  accessToken: string;
  fetchImpl?: typeof globalThis.fetch;
  actions?: React.ReactNode;
}

export const ValidatedVisualWorkCard = ({ work, bridgeBaseUrl, accessToken, fetchImpl = globalThis.fetch, actions }: ValidatedVisualWorkCardProps) => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const loadAccess = useCallback(async (forceRefresh = false) => {
    if (!work.artifact_id || !bridgeBaseUrl || !accessToken) {
      setUnavailable(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetchImpl(
        `${bridgeBaseUrl.replace(/\/+$/, "")}/api/artifacts/${encodeURIComponent(work.artifact_id)}/access-link`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const payload = await response.json().catch(() => ({})) as { url?: string; expires_at?: string };
      if (!response.ok || !payload.url) throw new Error("artifact_access_failed");
      if (!forceRefresh && payload.expires_at && Date.parse(payload.expires_at) <= Date.now() + 5_000) {
        await loadAccess(true);
        return;
      }
      setUrl(payload.url);
      setUnavailable(false);
    } catch {
      setUrl("");
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [accessToken, bridgeBaseUrl, fetchImpl, work.artifact_id]);

  useEffect(() => {
    setUrl("");
    setUnavailable(false);
    void loadAccess();
  }, [loadAccess, work.id]);

  const dimensions = work.artifact_width && work.artifact_height
    ? `${work.artifact_width} × ${work.artifact_height} px`
    : "Dimensões não informadas";

  return (
    <article className="group relative flex min-h-[300px] flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/75 p-4 shadow-glass backdrop-blur-xl sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge variant="outline" className="mb-2 border-cyan-200 bg-cyan-50 text-cyan-700">Peça visual</Badge>
          <h2 className="truncate text-lg font-bold text-text-primary">{work.title}</h2>
          <p className="mt-1 text-xs text-text-muted">{dimensions}</p>
        </div>
        {actions}
      </div>

      <div className="relative flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {loading ? <Loader2 className="h-6 w-6 animate-spin text-brand-primary" /> : unavailable || !url ? (
          <div className="flex flex-col items-center gap-2 px-6 text-center text-sm text-slate-500"><ImageOff className="h-8 w-8" /><span>Peça indisponível no momento.</span><Button size="sm" variant="outline" onClick={() => void loadAccess(true)}>Tentar novamente</Button></div>
        ) : (
          <button type="button" onClick={() => setPreviewOpen(true)} className="relative h-full w-full" aria-label={`Abrir preview de ${work.title}`}>
            <img src={url} alt={work.title} onError={() => void loadAccess(true)} className="max-h-72 w-full object-contain" />
            <span className="absolute bottom-2 right-2 rounded-full bg-slate-950/70 p-2 text-white opacity-0 transition group-hover:opacity-100"><Expand className="h-4 w-4" /></span>
          </button>
        )}
      </div>

      <footer className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs text-text-muted">
          <p className="truncate">{work.artifact_filename || "peça aprovada"}</p>
          <p className="truncate">Validada por {work.validated_by_name || "usuário ENS"}</p>
        </div>
        {url && !unavailable && (
          <Button asChild size="sm" variant="outline">
            <a href={url} download={work.artifact_filename || "peca.png"}><Download className="mr-2 h-4 w-4" />Baixar</a>
          </Button>
        )}
      </footer>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl bg-white">
          <DialogHeader><DialogTitle>{work.title}</DialogTitle><DialogDescription>{dimensions}</DialogDescription></DialogHeader>
          {url && <img src={url} alt={work.title} onError={() => void loadAccess(true)} className="max-h-[75vh] w-full rounded-xl bg-slate-100 object-contain" />}
        </DialogContent>
      </Dialog>
    </article>
  );
};
