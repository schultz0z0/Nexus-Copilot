import { Files, Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";

import { ChatInterface } from "@/components/ChatInterface";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { usePictureWorkspace } from "@/hooks/usePictureWorkspace";
import { chatService } from "@/lib/chatService";
import { createPictureWorkspaceClient } from "@/lib/pictureWorkspace/client";
import type { PictureWorkspaceClient, PictureWorkspaceFile } from "@/lib/pictureWorkspace/types";
import { supabase } from "@/lib/supabase";
import { PictureFilesPanel } from "./PictureFilesPanel";
import type { ResolvePictureAccessUrl } from "./PictureFilePreview";
import { PictureWorkspaceActions } from "./PictureWorkspaceActions";

const statusLabels: Record<string, string> = {
  drafting: "Montando briefing",
  generating: "Gerando",
  review: "Pronta para revisar",
  validated: "Aprovada",
  resetting: "Limpando workspace",
  failed: "Falha na geração",
};

interface PictureWorkspaceProps {
  client?: PictureWorkspaceClient;
}

export const PictureWorkspace = ({ client: providedClient }: PictureWorkspaceProps) => {
  const { session } = useAuth();
  const client = useMemo(() => providedClient ?? createPictureWorkspaceClient({
    baseUrl: chatService.resolveChatbotProxyBaseUrl() ?? "",
    getAccessToken: async () => {
      if (session?.access_token) return session.access_token;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  }), [providedClient, session?.access_token]);
  const state = usePictureWorkspace({ client });
  const accessCache = useRef(new Map<string, { url: string; expiresAt: string }>());

  const resolveAccessUrl = useCallback<ResolvePictureAccessUrl>(async (file: PictureWorkspaceFile, forceRefresh = false) => {
    const cached = accessCache.current.get(file.id);
    if (!forceRefresh && cached && Date.parse(cached.expiresAt) > Date.now() + 30_000) return cached;
    const access = await client.accessFile(file.id);
    accessCache.current.set(file.id, access);
    return access;
  }, [client]);

  const approve = async () => {
    try {
      await state.approve();
      toast.success("Peça aprovada e salva em Trabalhos Validados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível aprovar a peça.");
    }
  };
  const newPiece = async () => {
    try {
      await state.newPiece();
      accessCache.current.clear();
      toast.success("Novo workspace criado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar uma nova peça.");
      throw error;
    }
  };

  if (state.error && !state.workspace) {
    return (
      <div className="flex h-[calc(100dvh-6rem)] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-red-600">{state.error.message}</p>
        <Button variant="outline" onClick={() => void state.refresh()}>Tentar novamente</Button>
      </div>
    );
  }
  if (state.isLoading || !state.workspace) {
    return <div className="flex h-[calc(100dvh-6rem)] items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Preparando seu workspace Picture...</div>;
  }

  const panel = (
    <PictureFilesPanel
      files={state.files}
      candidateArtifactId={state.workspace.candidate_artifact_id}
      selectedFileId={state.selectedFileId}
      onSelectFile={state.setSelectedFileId}
      resolveAccessUrl={resolveAccessUrl}
      isLoading={state.isFilesLoading}
      error={state.error}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-0 flex-col bg-slate-50/50">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-900">{state.workspace.title || "Nova peça"}</h1>
          <p className="text-xs text-slate-500">Picture-Hermes · {statusLabels[state.workspace.status] ?? state.workspace.status}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild><Button size="sm" variant="outline"><Files className="mr-2 h-4 w-4" />Arquivos</Button></SheetTrigger>
              <SheetContent side="right" className="flex w-[92vw] max-w-xl flex-col p-0">
                <SheetHeader className="border-b p-5 pr-12"><SheetTitle>Arquivos da peça</SheetTitle><SheetDescription>Briefing, referências, versões e resultado final.</SheetDescription></SheetHeader>
                <div className="min-h-0 flex-1">{panel}</div>
              </SheetContent>
            </Sheet>
          </div>
          <PictureWorkspaceActions
            workspace={state.workspace}
            onApprove={approve}
            onNewPiece={newPiece}
            isApproving={state.isApproving}
            isCreatingNewPiece={state.isCreatingNewPiece}
          />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,11fr)_minmax(22rem,9fr)]">
        <main className="min-h-0 border-r border-slate-200 bg-white">
          <ChatInterface
            key={state.workspace.chat_session_id}
            experience="picture"
            fixedSessionId={state.workspace.chat_session_id}
            pictureWorkspaceId={state.workspace.id}
            hideHistory
            onActivitySettled={() => void state.refresh()}
          />
        </main>
        <aside className="hidden min-h-0 flex-col bg-white lg:flex">
          <div className="shrink-0 border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Arquivos da peça</h2>
            <p className="text-xs text-slate-500">Workspace temporário e candidata final</p>
          </div>
          <div className="min-h-0 flex-1">{panel}</div>
        </aside>
      </div>
    </div>
  );
};
