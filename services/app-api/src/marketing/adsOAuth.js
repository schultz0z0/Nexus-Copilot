import { createHmac, randomUUID } from "node:crypto";
import { validateSession } from "../auth/service.js";
import { createActorAssertion } from "./assertion.js";

const providers = new Set(["meta", "google", "linkedin"]);
async function boundedJson(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; } finally { reader.releaseLock(); }
}
export function oauthSessionBinding(token, assertion) {
  return createHmac("sha256", assertion.activeKey).update("ads-oauth-session\0").update(token).digest("hex");
}

// OAuth codes are delivered in navigation URLs. Keep them out of access logs.
export function requestLogSerializer(request) {
  const rawUrl = request.url || request.raw?.url || "";
  return { method: request.method, url: rawUrl.split("?")[0], hostname: request.hostname,
    remoteAddress: request.ip, remotePort: request.socket?.remotePort };
}

export async function adsOAuthRoutes(fastify, options) {
  const { config, db } = options;
  const marketing = config.marketingOps;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  fastify.get("/api/ads/oauth/:provider/callback", async (request, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
    const provider = request.params.provider;
    let resultProvider = provider;
    const redirect = result => reply.code(303).header("location", providers.has(provider)
      ? `/settings/integrations?provider=${resultProvider}&result=${result}`
      : "/settings/integrations?result=invalid").send();
    if (!providers.has(provider)) return redirect("invalid");
    const token = request.cookies?.[config.cookieName || "ens_session"];
    if (!token) return redirect("session_required");
    const actor = await validateSession(db, token);
    if (!actor?.tenant_id || !["admin", "manager"].includes(actor.role)) return redirect("session_required");
    const { state, code, error } = request.query;
    const valid = (value, limit = 1024) => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f]/.test(value);
    if (!valid(state) || (code !== undefined && !valid(code, 4096)) || (error !== undefined && !valid(error, 200)) || (!code && !error) || (code && error)) return redirect("invalid");
    const path = `/v1/ads-integrations/${provider}/callback`;
    const correlationId = randomUUID();
    try {
      const headers = new Headers({ "content-type": "application/json", "x-correlation-id": correlationId,
        "x-ens-oauth-session": oauthSessionBinding(token, marketing.assertion),
        "x-ens-actor-assertion": await createActorAssertion({ actor, correlationId, method: "POST", path }, marketing.assertion) });
      const upstream = await fetchImpl(`${marketing.internalUrl}${path}`, { method: "POST", headers,
        body: JSON.stringify({ state, ...(code ? { code } : { error }) }), redirect: "error", signal: AbortSignal.timeout(provider === "google" ? 120_000 : marketing.timeoutMs) });
      if (provider === "google" && upstream.headers.get("x-ens-oauth-intent") === "ga4") resultProvider = "ga4";
      // Never echo provider errors, codes, state, account URLs or arbitrary redirects.
      if (upstream.ok) {
        const body = await boundedJson(upstream);
        if (provider === "google" && body?.data?.provider === "ga4") resultProvider = "ga4";
        return redirect(error ? "cancelled" : "connected");
      }
      if (error && upstream.status === 400) return redirect("cancelled");
      if ([400, 409, 410, 422].includes(upstream.status)) return redirect("invalid");
      if ([401, 403].includes(upstream.status)) return redirect("permission_required");
      if (upstream.status === 502) {
        try {
          const body = await boundedJson(upstream);
          if (["ads_permission_required", "analytics_permission_required", "analytics_api_disabled"].includes(body?.error?.code)) return redirect("permission_required");
        } catch { /* Keep unknown upstream content out of redirects and logs. */ }
      }
      return redirect("unavailable");
    } catch { return redirect("unavailable"); }
  });
}
