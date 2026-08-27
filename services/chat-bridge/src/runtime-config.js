const placeholder = /^(?:(?:change|replace)[-_]?me|placeholder|example|secret)(?:[-_].*)?$/i;

const value = (env, names) => names.map((name) => env[name]?.trim()).find(Boolean) || "";

const isStrongSecret = (secret) => secret.length >= 32 && !placeholder.test(secret);

const isHttpUrl = (candidate) => {
  try {
    return ["http:", "https:"].includes(new URL(candidate).protocol);
  } catch {
    return false;
  }
};

export const validateBridgeRuntimeConfig = (env = process.env) => {
  const production = env.NODE_ENV === "production";
  const allowInsecureLocalAuth = !production && env.BRIDGE_ALLOW_INSECURE_LOCAL_AUTH === "true";
  const configuredDecisionTimeoutMs = Number(env.MARKETING_OPS_DECISION_TIMEOUT_MS || 15_000);
  const marketingOpsDecisionTimeoutMs = Number.isFinite(configuredDecisionTimeoutMs)
    ? Math.max(1_000, Math.min(60_000, Math.trunc(configuredDecisionTimeoutMs)))
    : 15_000;
  const supabaseUrl = value(env, ["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const supabaseAnonKey = value(env, ["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  const supabaseServiceRoleKey = value(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    if (!allowInsecureLocalAuth) {
      const missing = !supabaseUrl ? "SUPABASE_URL" : !supabaseAnonKey ? "SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY";
      throw new Error(`${missing} is required; set BRIDGE_ALLOW_INSECURE_LOCAL_AUTH=true only for isolated local development`);
    }
  }
  const activeKid = value(env, ["MARKETING_OPS_DELEGATION_ACTIVE_KID"]);
  const activeKey = value(env, ["MARKETING_OPS_DELEGATION_ACTIVE_KEY"]);
  if (production && (!activeKid || !activeKey || placeholder.test(activeKey))) {
    throw new Error("MARKETING_OPS_DELEGATION_ACTIVE_KID and MARKETING_OPS_DELEGATION_ACTIVE_KEY are required in production");
  }
  const delegationRefreshKey = value(env, ["MARKETING_OPS_DELEGATION_REFRESH_KEY"]);
  if (production && (!delegationRefreshKey || placeholder.test(delegationRefreshKey))) {
    throw new Error("MARKETING_OPS_DELEGATION_REFRESH_KEY is required in production");
  }
  const pictureInternalUrl = value(env, ["PICTURE_INTERNAL_URL"]);
  const pictureInternalKey = value(env, ["PICTURE_INTERNAL_KEY"]);
  const pictureDelegationActiveKid = value(env, ["PICTURE_DELEGATION_ACTIVE_KID"]);
  const pictureDelegationActiveKey = value(env, ["PICTURE_DELEGATION_ACTIVE_KEY"]);
  const pictureDelegationIssuer = value(env, ["PICTURE_DELEGATION_ISSUER"]) || "nexus-chat-bridge";
  const pictureDelegationAudience = value(env, ["PICTURE_DELEGATION_AUDIENCE"]) || "nexus-picture";
  const pictureDelegationRefreshKey = value(env, ["PICTURE_DELEGATION_REFRESH_KEY"]);
  if (production && !isHttpUrl(pictureInternalUrl)) {
    throw new Error("PICTURE_INTERNAL_URL must be a valid http(s) URL in production");
  }
  if (production && !isStrongSecret(pictureInternalKey)) {
    throw new Error("PICTURE_INTERNAL_KEY must contain at least 32 non-placeholder characters in production");
  }
  if (production && (!pictureDelegationActiveKid || !isStrongSecret(pictureDelegationActiveKey))) {
    throw new Error("PICTURE_DELEGATION_ACTIVE_KID and PICTURE_DELEGATION_ACTIVE_KEY are required in production");
  }
  if (production && pictureDelegationIssuer !== "nexus-chat-bridge") {
    throw new Error("PICTURE_DELEGATION_ISSUER must be nexus-chat-bridge in production");
  }
  if (production && pictureDelegationAudience !== "nexus-picture") {
    throw new Error("PICTURE_DELEGATION_AUDIENCE must be nexus-picture in production");
  }
  if (production && !isStrongSecret(pictureDelegationRefreshKey)) {
    throw new Error("PICTURE_DELEGATION_REFRESH_KEY must contain at least 32 non-placeholder characters in production");
  }
  return {
    production,
    allowInsecureLocalAuth,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    activeKid,
    activeKey,
    delegationRefreshKey,
    marketingOpsDecisionTimeoutMs,
    pictureInternalUrl,
    pictureInternalKey,
    pictureDelegationActiveKid,
    pictureDelegationActiveKey,
    pictureDelegationIssuer,
    pictureDelegationAudience,
    pictureDelegationRefreshKey,
  };
};
