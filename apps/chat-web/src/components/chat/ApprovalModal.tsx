// ApprovalModal.tsx
// Modal que aparece quando o agent precisa de aprovacao de comando.
// Intregracao com /api/approvals/respond (via chat-bridge) e SSE stream.
//
// Adicionado em 2026-06-27 - Opcao C (WebSocket approval system).
// Parte do PR: feat/frontend-approval-system.

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Shield } from "lucide-react";

export interface ApprovalRequest {
  request_id: string;
  event: string;
  command: string;
  description: string;
  expires_in: number; // segundos
}

interface ApprovalModalProps {
  request: ApprovalRequest | null;
  onRespond: (decision: "approve" | "deny", trustScope?: "session" | "always") => Promise<void>;
  onDismiss?: () => void;
}

export function ApprovalModal({ request, onRespond, onDismiss }: ApprovalModalProps) {
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [countdown, setCountdown] = useState(request?.expires_in ?? 0);

  // Countdown ate expirar
  useEffect(() => {
    if (!request) return;
    setCountdown(request.expires_in);
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          // Auto-deny quando expira
          if (!submitting) {
            void onRespond("deny");
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [request?.request_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = useCallback(
    async (decision: "approve" | "deny") => {
      if (submitting) return;
      setSubmitting(decision);
      try {
        await onRespond(decision, rememberChoice ? "always" : "session");
      } finally {
        setSubmitting(null);
      }
    },
    [onRespond, rememberChoice, submitting]
  );

  if (!request) return null;

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onDismiss?.()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            Approve Command
          </DialogTitle>
          <DialogDescription>
            The agent wants to run a potentially dangerous command on your behalf.
            Review carefully before approving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 font-mono text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
            {request.command}
          </div>

          {request.description && request.description !== request.command && (
            <p className="text-sm text-muted-foreground">{request.description}</p>
          )}

          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Commands run with full user credentials. Only approve commands you
              trust. Auto-deny in {countdown}s if no response.
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="rounded border-input"
              disabled={submitting !== null}
            />
            Remember for this session (skip future prompts for this command)
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="destructive"
            onClick={() => handle("deny")}
            disabled={submitting !== null}
          >
            {submitting === "deny" ? "Denying..." : "Deny"}
          </Button>
          <Button
            variant="default"
            onClick={() => handle("approve")}
            disabled={submitting !== null}
          >
            {submitting === "approve" ? "Approving..." : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
