import { describe, expect, it } from "vitest";

import { getComposerTextareaLayout } from "./chatComposerTextarea";

describe("getComposerTextareaLayout", () => {
  it("returns no DOM update when height and overflow are already stable", () => {
    expect(
      getComposerTextareaLayout({
        scrollHeight: 48,
        currentHeight: "48px",
        currentOverflowY: "hidden",
        maxHeight: 240,
      }),
    ).toBeNull();
  });

  it("caps multiline textarea height and enables internal scroll only after the max height", () => {
    expect(
      getComposerTextareaLayout({
        scrollHeight: 320,
        currentHeight: "48px",
        currentOverflowY: "hidden",
        maxHeight: 240,
      }),
    ).toEqual({ height: "240px", overflowY: "auto" });
  });
});
