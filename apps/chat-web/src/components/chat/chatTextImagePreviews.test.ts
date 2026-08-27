import { describe, expect, it } from "vitest";

import { createFilePart, createTextPart } from "@/lib/chatMessageParts";
import { extractRenderableImagePreviewsFromParts } from "./chatTextImagePreviews";

const publicHermesHost = "jhbakzkqamgddphwakjj.supabase.co";
const publicHermesImageUrl =
  `https://${publicHermesHost}/storage/v1/object/public/hermes-images/generated/2026/06/05/china-immersion-8235b75eec38.jpg`;

describe("extractRenderableImagePreviewsFromParts", () => {
  it("gera preview para url publica de imagem enviada no texto do Hermes", () => {
    const previews = extractRenderableImagePreviewsFromParts(
      [createTextPart(`Entregas consolidadas URL publica:\n${publicHermesImageUrl}`)],
      [publicHermesHost],
    );

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      kind: "image",
      name: "china-immersion-8235b75eec38.jpg",
      url: publicHermesImageUrl,
    });
  });

  it("nao gera preview para host fora da allowlist", () => {
    const previews = extractRenderableImagePreviewsFromParts(
      [createTextPart("https://evil.example/generated/image.png")],
      [publicHermesHost],
    );

    expect(previews).toEqual([]);
  });

  it("nao duplica preview quando o arquivo ja veio estruturado", () => {
    const previews = extractRenderableImagePreviewsFromParts(
      [
        createTextPart(publicHermesImageUrl),
        createFilePart({
          kind: "image",
          name: "china-immersion-8235b75eec38.jpg",
          url: publicHermesImageUrl,
        }),
      ],
      [publicHermesHost],
    );

    expect(previews).toEqual([]);
  });
});
