// useApprovalStream.ts
// Hook que conecta no SSE /api/approvals/stream do chat-bridge e expõe
// o request de approval atual pro componente ApprovalModal.
//
// Adicionado em 2026-06-27 - Opcao C.

import { useEffect, useRef, useState, useCallback } from "react";
import type { ApprovalRequest } from "./ApprovalModal";

interface UseApprovalStreamOptions {
  /** URL completa do chat-bridge (sem trailing slash). */
  bridgeBaseUrl: string;
  /** Token de auth (Supabase access_token) - se aplicavel. */
  getAccessToken?: () => Promise<string | null>;
  /** Callback quando request chega (pra toast, log, etc). */
  onRequest?: (req: ApprovalRequest) => void;
}

export function useApprovalStream({ bridgeBaseUrl, getAccessToken, onRequest }: UseApprovalStreamOptions) {
  const [currentRequest, setCurrentRequest] = useState<ApprovalRequest | null>(null);
  const [connected, setConnected] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const respond = useCallback(
    async (decision: "approve" | "deny", trustScope: "session" | "always" = "session") => {
      if (!currentRequest) return;
      const requestId = currentRequest.request_id;
      // Optimistic close
      setCurrentRequest(null);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (getAccessToken) {
          const token = await getAccessToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        }
        const res = await fetch(`${bridgeBaseUrl}/api/approvals/respond`, {
          method: "POST",
          headers,
          body: JSON.stringify({ request_id: requestId, decision, trust_scope: trustScope }),
        });
        if (!res.ok) {
          console.warn("[approval] respond failed:", res.status, await res.text().catch(() => ""));
        }
      } catch (err) {
        console.error("[approval] respond error:", err);
      }
    },
    [bridgeBaseUrl, currentRequest, getAccessToken]
  );

  // Conecta no SSE
  useEffect(() => {
    let cancelled = false;
    if (!bridgeBaseUrl) {
      setConnected(false);
      return () => {
        cancelled = true;
        abortRef.current?.abort();
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      };
    }

    const connect = async () => {
      if (cancelled) return;
      const controller = new AbortController();
      abortRef.current = controller;

      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (getAccessToken) {
        const token = await getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      try {
        const res = await fetch(`${bridgeBaseUrl}/api/approvals/stream`, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`SSE connect failed: ${res.status}`);
        }
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Parse SSE: eventos separados por \n\n, dados em "data: ..."
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6));
              if (payload?.type === "approval_request" && payload?.request_id) {
                const req: ApprovalRequest = {
                  request_id: payload.request_id,
                  event: payload.event || "unknown",
                  command: payload.command || "",
                  description: payload.description || "",
                  expires_in: payload.expires_in ?? 30,
                };
                setCurrentRequest(req);
                onRequest?.(req);
              }
            } catch {
              // ignore parse error
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[approval] SSE disconnected, retrying in 5s:", err);
          setConnected(false);
          // Reconnect com backoff simples
          reconnectTimerRef.current = setTimeout(connect, 5000);
        }
      } finally {
        setConnected(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [bridgeBaseUrl, getAccessToken, onRequest]);

  return { currentRequest, respond, connected };
}
