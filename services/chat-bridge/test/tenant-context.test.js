import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrustedTenantId } from "../src/tenant-context.js";

test("trusted tenant resolution prefers Supabase metadata over client headers", () => {
  const tenantId = resolveTrustedTenantId({
    user: {
      app_metadata: { tenant_id: "ens" },
      user_metadata: { tenant_id: "spoofed" },
    },
    requestedTenantId: "evil-client",
    fallbackTenantId: "ens",
    trustClientHeader: false,
  });

  assert.equal(tenantId, "ens");
});

test("trusted tenant resolution ignores client tenant headers for authenticated production sessions", () => {
  const tenantId = resolveTrustedTenantId({
    user: { app_metadata: {}, user_metadata: {} },
    requestedTenantId: "evil-client",
    fallbackTenantId: "ens",
    trustClientHeader: false,
  });

  assert.equal(tenantId, "ens");
});

test("trusted tenant resolution never accepts user_metadata authority", () => {
  const tenantId = resolveTrustedTenantId({
    user: { app_metadata: {}, user_metadata: { tenant_id: "spoofed" } },
    fallbackTenantId: "ens",
    trustClientHeader: false,
  });
  assert.equal(tenantId, "ens");
});

test("trusted tenant resolution can trust client header only for no-Supabase local fallback", () => {
  const tenantId = resolveTrustedTenantId({
    requestedTenantId: "ens",
    fallbackTenantId: "public",
    trustClientHeader: true,
  });

  assert.equal(tenantId, "ens");
});
