import { api } from "./api";

export interface TenantContext {
  "X-Tenant-Id": string;
  "X-User-Id": string;
  Authorization?: string;
}

const BEARER_PREFIX = "Bearer ";

/**
 * Extrai tenant_id e user_id da sessao ativa via App API.
 * Retorna "public"/"anonymous" como fallback se nao logado.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const fallback: TenantContext = {
    "X-Tenant-Id": "public",
    "X-User-Id": "anonymous",
  };

  try {
    const { user } = await api.auth.me();
    if (!user) return fallback;

    const tenantId = user.tenant_id || "public";
    const userId = user.id || "anonymous";

    const headers: TenantContext = {
      "X-Tenant-Id": tenantId,
      "X-User-Id": userId,
      Authorization: BEARER_PREFIX + userId,
    };
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
  return {};
}
