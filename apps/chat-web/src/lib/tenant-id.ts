/**
 * tenant-id.ts — Multi-tenant + multi-user context helper (v3.8+ white-label).
 *
 * Extrai tenant_id e user_id do JWT do Supabase automaticamente.
 * Esses valores sao injetados em TODAS as chamadas que batem no bridge/hermes-api.
 *
 * USAGE:
 *   import { getTenantContext, graphHeaders, memoryHeaders } from "@/lib/tenant-id";
 *
 *   fetch("/api/chat/message", {
 *     method: "POST",
 *     headers: {
 *       ...(await getTenantContext()),
 *       "Content-Type": "application/json",
 *     },
 *     body: JSON.stringify({ message: "..." })
 *   })
 *
 * CONTRATO:
 *   - tenant_id: SEMPRE vem do JWT (raw_user_meta_data->tenant_id)
 *   - user_id:  vem do JWT (sub = user uuid)
 *   - Se nao logado: retorna "public" / "anonymous" (bridge/hermes lida com fallback)
 *
 * IMPORTANTE: O hermes-api valida regex ^[a-z0-9_-]{3,64}$ no tenant_id,
 * entao valores invalidos sao rejeitados com 400.
 */

import { supabase } from "./supabase";

export interface TenantContext {
  "X-Tenant-Id": string;
  "X-User-Id": string;
  Authorization?: string;
}

const BEARER_PREFIX = "Bearer ";

/**
 * Extrai tenant_id e user_id da sessao Supabase ativa.
 * Retorna "public"/"anonymous" como fallback se nao logado.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const fallback: TenantContext = {
    "X-Tenant-Id": "public",
    "X-User-Id": "anonymous",
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return fallback;

    const payloadBase64 = session.access_token.split(".")[1];
    if (!payloadBase64) return fallback;

    const payloadJson = atob(
      payloadBase64.replace(/-/g, "+").replace(/_/g, "/")
    );
    const payload = JSON.parse(payloadJson);

    const tenantId =
      payload.user_metadata?.tenant_id ||
      payload.app_metadata?.tenant_id ||
      "public";
    const userId = payload.sub || "anonymous";

    const headers: TenantContext = {
      "X-Tenant-Id": tenantId,
      "X-User-Id": userId,
    };
    headers.Authorization = BEARER_PREFIX + session.access_token;
    return headers;
  } catch (err) {
    console.warn("[tenant-id] Failed to extract tenant context:", err);
    return fallback;
  }
}

export async function graphHeaders(): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    ...(await getTenantContext()),
  };
}

export async function memoryHeaders(): Promise<HeadersInit> {
  const ctx = await getTenantContext();
  return {
    "Content-Type": "application/json",
    ...ctx,
  };
}

export function useTenantContext() {
  return { supabase };
}
