const defaultComposerTextareaMaxHeight = 240;

export const getComposerTextareaLayout = ({
  scrollHeight,
  currentHeight,
  currentOverflowY,
  maxHeight = defaultComposerTextareaMaxHeight,
}: {
  scrollHeight: number;
  currentHeight: string;
  currentOverflowY: string;
  maxHeight?: number;
}): { height: string; overflowY: "auto" | "hidden" } | null => {
  const nextHeight = `${Math.min(scrollHeight, maxHeight)}px`;
  const nextOverflowY = scrollHeight > maxHeight ? "auto" : "hidden";

  if (currentHeight === nextHeight && currentOverflowY === nextOverflowY) {
    return null;
  }

  return { height: nextHeight, overflowY: nextOverflowY };
};
