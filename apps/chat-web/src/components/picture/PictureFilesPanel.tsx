import { CheckCircle2, File, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { PictureWorkspaceFile } from "@/lib/pictureWorkspace/types";
import { PictureFilePreview, type ResolvePictureAccessUrl } from "./PictureFilePreview";

const categoryLabels: Record<string, string> = {
  brief: "Briefing",
  prompt: "Prompt",
  plan: "Plano de composição",
  step: "Etapas",
  overlay: "Overlays",
  reference: "Referências",
  intermediate: "Intermediários",
  final: "Final",
};

interface PictureFilesPanelProps {
  files: PictureWorkspaceFile[];
  candidateArtifactId?: string | null;
  selectedFileId?: string | null;
  onSelectFile?: (fileId: string) => void;
  resolveAccessUrl: ResolvePictureAccessUrl;
  isLoading?: boolean;
  error?: Error | null;
}

export const PictureFilesPanel = ({
  files,
  candidateArtifactId,
  selectedFileId,
  onSelectFile,
  resolveAccessUrl,
  isLoading = false,
  error = null,
}: PictureFilesPanelProps) => {
  const [internalSelection, setInternalSelection] = useState<string | null>(null);
  const controlled = selectedFileId !== undefined;
  const effectiveSelection = controlled ? selectedFileId ?? null : internalSelection;
  const previousCandidateId = useRef(candidateArtifactId);
  const selectFile = useCallback((fileId: string) => {
    if (!controlled) setInternalSelection(fileId);
    onSelectFile?.(fileId);
  }, [controlled, onSelectFile]);
  const selected = files.find((entry) => entry.id === effectiveSelection) ?? null;
  const groups = useMemo(() => {
    const grouped = new Map<string, PictureWorkspaceFile[]>();
    files.forEach((entry) => grouped.set(entry.category, [...(grouped.get(entry.category) ?? []), entry]));
    return Array.from(grouped.entries());
  }, [files]);
  const versions = useMemo(() => {
    const byName = new Map<string, Array<{ entry: PictureWorkspaceFile; index: number }>>();
    files.forEach((entry, index) => {
      byName.set(entry.filename, [...(byName.get(entry.filename) ?? []), { entry, index }]);
    });
    const result = new Map<string, number>();
    for (const entries of byName.values()) {
      if (entries.length < 2) continue;
      entries
        .sort((left, right) => {
          const leftTime = left.entry.created_at ? Date.parse(left.entry.created_at) : Number.NaN;
          const rightTime = right.entry.created_at ? Date.parse(right.entry.created_at) : Number.NaN;
          if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
            return leftTime - rightTime;
          }
          return left.index - right.index;
        })
        .forEach(({ entry }, index) => result.set(entry.id, index + 1));
    }
    return result;
  }, [files]);

  useEffect(() => {
    const candidateChanged = previousCandidateId.current !== candidateArtifactId;
    previousCandidateId.current = candidateArtifactId;
    if (files.length === 0) return;
    const candidate = candidateArtifactId
      ? files.find((entry) => entry.id === candidateArtifactId || entry.artifact_id === candidateArtifactId)
      : undefined;
    if (candidate && (candidateChanged || !effectiveSelection)) {
      selectFile(candidate.id);
      return;
    }
    if (!effectiveSelection) selectFile(files[0].id);
  }, [candidateArtifactId, effectiveSelection, files, selectFile]);

  if (isLoading) return <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando arquivos...</div>;
  if (error && files.length === 0) return <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-600">Não foi possível carregar os arquivos da peça.</div>;
  if (files.length === 0) return <div className="flex h-full min-h-64 items-center justify-center px-8 text-center text-sm leading-6 text-slate-500">Converse com o Hermes e envie suas referências. Briefing, planos, versões e a peça final aparecerão aqui.</div>;

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(10rem,0.9fr)_minmax(14rem,1.1fr)]">
      <div className="overflow-y-auto border-b border-slate-200 p-3">
        {groups.map(([category, entries]) => (
          <section key={category} className="mb-4">
            <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{categoryLabels[category] ?? category}</h3>
            <div className="space-y-1">
              {entries.map((entry) => {
                const candidate = Boolean(candidateArtifactId)
                  && (entry.id === candidateArtifactId || entry.artifact_id === candidateArtifactId);
                const version = versions.get(entry.id);
                return (
                  <button
                    type="button"
                    key={entry.id}
                    onClick={() => selectFile(entry.id)}
                    className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100", effectiveSelection === entry.id && "bg-cyan-50 text-cyan-900")}
                  >
                    <File className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.filename}{version ? ` (v${version})` : ""}
                    </span>
                    {candidate && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />Peça final</span>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="min-h-0 overflow-auto p-3"><PictureFilePreview file={selected} resolveAccessUrl={resolveAccessUrl} /></div>
    </div>
  );
};
