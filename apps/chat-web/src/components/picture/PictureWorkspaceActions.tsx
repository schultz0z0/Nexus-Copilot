import { Check, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PictureWorkspace } from "@/lib/pictureWorkspace/types";

interface PictureWorkspaceActionsProps {
  workspace: PictureWorkspace;
  onApprove: () => Promise<unknown>;
  onNewPiece: () => Promise<unknown>;
  isApproving?: boolean;
  isCreatingNewPiece?: boolean;
}

export const PictureWorkspaceActions = ({ workspace, onApprove, onNewPiece, isApproving = false, isCreatingNewPiece = false }: PictureWorkspaceActionsProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const approveEnabled = workspace.status === "review" && !isApproving;
  const newPieceEnabled = workspace.status !== "resetting" && !isCreatingNewPiece;

  const confirm = async () => {
    if (confirming || isCreatingNewPiece) return;
    setConfirming(true);
    try {
      await onNewPiece();
      setConfirmOpen(false);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!approveEnabled} onClick={() => void onApprove()}><Check className="mr-2 h-4 w-4" />{isApproving ? "Aprovando..." : "Aprovar peça"}</Button>
        <Button size="sm" variant="outline" disabled={!newPieceEnabled} onClick={() => setConfirmOpen(true)}><Plus className="mr-2 h-4 w-4" />Criar nova peça</Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={(open) => !confirming && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar uma nova peça?</AlertDialogTitle>
            <AlertDialogDescription>
              O chat, briefing, arquivos auxiliares, JSONs e versões intermediárias deste trabalho serão apagados permanentemente. Se a peça final tiver sido aprovada, ela continuará disponível em Trabalhos Validados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={confirming} onClick={(event) => { event.preventDefault(); void confirm(); }}>
              {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar e criar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
