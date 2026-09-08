import assert from "node:assert/strict";
import test from "node:test";

import { copiedFileContentsAreEquivalent } from "../../scripts/lib/copied-file-content.mjs";

test("accepts checkout-only line ending differences in text files", () => {
  const lf = Buffer.from("first\nsecond\n", "utf8");
  const crlf = Buffer.from("first\r\nsecond\r\n", "utf8");
  const duplicatedCarriageReturn = Buffer.from("first\r\r\nsecond\r\r\n", "utf8");

  assert.equal(copiedFileContentsAreEquivalent(lf, crlf), true);
  assert.equal(copiedFileContentsAreEquivalent(lf, duplicatedCarriageReturn), true);
});

test("rejects substantive text differences", () => {
  assert.equal(
    copiedFileContentsAreEquivalent(
      Buffer.from("first\nsecond\n", "utf8"),
      Buffer.from("first\nchanged\n", "utf8"),
    ),
    false,
  );
});

test("requires byte equality for binary files", () => {
  const first = Buffer.from([0x00, 0x0d, 0x0a, 0xff]);
  const second = Buffer.from([0x00, 0x0a, 0xff]);
  const invalidUtf8First = Buffer.from([0xff, 0x0d, 0x0a]);
  const invalidUtf8Second = Buffer.from([0xfe, 0x0a]);

  assert.equal(copiedFileContentsAreEquivalent(first, Buffer.from(first)), true);
  assert.equal(copiedFileContentsAreEquivalent(first, second), false);
  assert.equal(copiedFileContentsAreEquivalent(invalidUtf8First, invalidUtf8Second), false);
});
