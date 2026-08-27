export const normalizeTenantId = (value, fallback = "ens") => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^[a-z0-9_-]{3,64}$/.test(normalized)) return normalized;
  return /^[a-z0-9_-]{3,64}$/.test(fallback) ? fallback : "ens";
};

export const resolveTrustedTenantId = ({
  user,
  requestedTenantId,
  fallbackTenantId = "ens",
  trustClientHeader = false,
} = {}) => {
  const metadataTenant = user?.app_metadata?.tenant_id;

  if (metadataTenant) {
    return normalizeTenantId(metadataTenant, fallbackTenantId);
  }

  if (trustClientHeader) {
    return normalizeTenantId(requestedTenantId, fallbackTenantId);
  }

  return normalizeTenantId(fallbackTenantId, "ens");
};
