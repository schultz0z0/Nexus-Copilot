const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const normalizeTextLineEndings = (contents) =>
  utf8Decoder.decode(contents).replace(/\r+\n/gu, "\n").replace(/\r/gu, "\n");

export function copiedFileContentsAreEquivalent(first, second) {
  if (first.includes(0x00) || second.includes(0x00)) {
    return first.equals(second);
  }

  try {
    return normalizeTextLineEndings(first) === normalizeTextLineEndings(second);
  } catch (error) {
    if (error instanceof TypeError) {
      return first.equals(second);
    }

    throw error;
  }
}
