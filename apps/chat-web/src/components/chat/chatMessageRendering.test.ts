import { describe, expect, it } from "vitest";

import {
  getStreamingRenderChunkSize,
  getStreamingRenderFrameDelayMs,
  shouldExtractTextImagePreviews,
  getTextRenderMode,
} from "./chatMessageRendering";

describe("getTextRenderMode", () => {
  it("uses a lightweight text renderer while a long assistant response is streaming", () => {
    expect(
      getTextRenderMode({
        role: "assistant",
        isStreaming: true,
        textLength: 4_001,
      }),
    ).toBe("plain");
  });

  it("keeps markdown rendering for completed assistant responses", () => {
    expect(
      getTextRenderMode({
        role: "assistant",
        isStreaming: false,
        textLength: 16_000,
      }),
    ).toBe("markdown");
  });
});

describe("shouldExtractTextImagePreviews", () => {
  it("skips assistant text image URL scanning while a response is streaming", () => {
    expect(shouldExtractTextImagePreviews({ role: "assistant", isStreaming: true })).toBe(false);
  });

  it("allows assistant text image URL scanning after the response completes", () => {
    expect(shouldExtractTextImagePreviews({ role: "assistant", isStreaming: false })).toBe(true);
  });
});

describe("streaming render pacing", () => {
  it("renders large streaming backlogs in sizeable batches instead of tiny character chunks", () => {
    expect(getStreamingRenderChunkSize(5_000)).toBeGreaterThanOrEqual(1_000);
    expect(getStreamingRenderFrameDelayMs(5_000)).toBeLessThanOrEqual(40);
  });

  it("keeps small streaming updates responsive without repainting on every character", () => {
    expect(getStreamingRenderChunkSize(80)).toBeGreaterThanOrEqual(80);
    expect(getStreamingRenderFrameDelayMs(80)).toBeGreaterThanOrEqual(60);
  });
});
