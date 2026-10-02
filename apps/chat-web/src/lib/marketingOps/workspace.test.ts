import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceClient,
  parseWorkspaceMetric,
  safeWorkspaceAuthorizationUrl,
  safeWorkspaceResourceUrl,
} from "./workspace";
describe("Workspace BFF contract", () => {
  it("parses explicit Brazilian spreadsheet values without making blanks zero", () => {
    expect(parseWorkspaceMetric("R$ 1.234,56")).toBe(1234.56);
    expect(parseWorkspaceMetric("1.234")).toBe(1234);
    expect(parseWorkspaceMetric("12,5")).toBe(12.5);
    expect(parseWorkspaceMetric("  ")).toBeUndefined();
    expect(() => parseWorkspaceMetric("-2")).toThrow();
    expect(() => parseWorkspaceMetric("12x")).toThrow();
    expect(() => parseWorkspaceMetric("1.23")).toThrow();
  });
  it("fences mail sends with version, proposal and explicit confirmation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { status: "completed" } }));
    await createWorkspaceClient({ fetch }).sendDraft(
      "google_gmail",
      "draft/1",
      7,
      "proposal",
      "campaign",
    );
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "/api/marketing/workspace/google_gmail/drafts/draft%2F1/send",
    );
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("If-Match")).toBe('"7"');
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("proposal");
    expect(JSON.parse(init.body)).toEqual({
      confirm: true,
      campaignId: "campaign",
    });
  });
  it("never trusts raw provider errors or arbitrary navigation URLs", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "workspace_permission_required",
            message: "secret token",
          },
        },
        { status: 403 },
      ),
    );
    await expect(
      createWorkspaceClient({ fetch }).connections(),
    ).rejects.not.toThrow("secret token");
    expect(
      safeWorkspaceAuthorizationUrl(
        "google_drive",
        "https://accounts.google.com/o/oauth2/v2/auth",
      ),
    ).toBe(true);
    expect(
      safeWorkspaceAuthorizationUrl(
        "microsoft_mail",
        "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
      ),
    ).toBe(true);
    expect(
      safeWorkspaceAuthorizationUrl(
        "google_drive",
        "https://accounts.google.com.attacker.test",
      ),
    ).toBe(false);
    expect(safeWorkspaceResourceUrl("https://drive.google.com/file/d/1")).toBe(
      true,
    );
    expect(safeWorkspaceResourceUrl("https://evil.test")).toBe(false);
  });
  it("keeps credentials in transient POST bodies and encodes opaque resources", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: {} }));
    const api = createWorkspaceClient({ fetch });
    await api.saveApp(
      "microsoft",
      { clientId: "client", clientSecret: "private", tenantId: "tenant" },
      0,
      "setup",
    );
    await api.resources("microsoft_files", {
      parentId: "drive:a/b",
      search: "briefing & launch",
    });
    expect(fetch.mock.calls[0][0]).not.toContain("private");
    expect(fetch.mock.calls[1][0]).toContain("parentId=drive%3Aa%2Fb");
  });
});
