import { describe, expect, it, vi } from "vitest";

import { downloadChatFile } from "./chatFileDownloads";

describe("downloadChatFile", () => {
  it("baixa o arquivo via blob URL para evitar navegar para links assinados cross-origin", async () => {
    const clicked = vi.fn();
    const removed = vi.fn();
    const appended: unknown[] = [];
    const createdLink = {
      click: clicked,
      remove: removed,
      href: "",
      download: "",
      rel: "",
    } as HTMLAnchorElement;
    const createElement = vi.fn(() => createdLink);
    const createObjectURL = vi.fn(() => "blob:download");
    const revokeObjectURL = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    })) as unknown as typeof fetch;

    await downloadChatFile({
      url: "https://project.supabase.co/storage/v1/object/sign/image.png?token=abc",
      fileName: "imagem.png",
      fetchImpl,
      documentRef: {
        createElement,
        body: {
          appendChild: (node: unknown) => appended.push(node),
        },
      } as unknown as Document,
      urlApi: {
        createObjectURL,
        revokeObjectURL,
      } as unknown as typeof URL,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://project.supabase.co/storage/v1/object/sign/image.png?token=abc");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdLink.href).toBe("blob:download");
    expect(createdLink.download).toBe("imagem.png");
    expect(createdLink.rel).toBe("noopener noreferrer");
    expect(appended).toEqual([createdLink]);
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });
});
