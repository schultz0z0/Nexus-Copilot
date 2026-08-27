import assert from "node:assert/strict";
import test from "node:test";

import { zipSync } from "fflate";

import { extractAttachmentText } from "../src/attachment-text.js";

const textEncoder = new TextEncoder();

test("extractAttachmentText preserves HTML source as code", () => {
  const html = "<html><body><h1>Titulo</h1><p>Conteudo &amp; CTA</p><script>alert(1)</script></body></html>";
  const text = extractAttachmentText(
    { name: "pagina.html", mime_type: "text/html" },
    textEncoder.encode(html),
  );

  assert.equal(text, html);
  assert.match(text, /<script>alert\(1\)<\/script>/);
});

test("extractAttachmentText treats JSON as plain readable text", () => {
  const text = extractAttachmentText(
    { name: "dados.json", mime_type: "application/json" },
    textEncoder.encode(JSON.stringify({ curso: "China Immersion" })),
  );

  assert.match(text, /China Immersion/);
});

test("extractAttachmentText preserves large plain text/code files without truncating", () => {
  const largeCode = [
    "const header = 'inicio';",
    "x".repeat(16_000),
    "const footer = 'fim-do-arquivo';",
  ].join("\n");

  const text = extractAttachmentText(
    { name: "template.js", mime_type: "text/plain" },
    textEncoder.encode(largeCode),
  );

  assert.equal(text, largeCode);
  assert.match(text, /fim-do-arquivo/);
});

test("extractAttachmentText preserves large PDF text extraction without silent truncation", () => {
  const pdfLikeContent = [
    "%PDF-1.7",
    "inicio do pdf",
    "x".repeat(16_000),
    "fim-do-pdf-nao-pode-sumir",
  ].join("\n");

  const text = extractAttachmentText(
    { name: "relatorio.pdf", mime_type: "application/pdf" },
    textEncoder.encode(pdfLikeContent),
  );

  assert.match(text, /inicio do pdf/);
  assert.match(text, /fim-do-pdf-nao-pode-sumir/);
  assert.ok(text.length > 16_000);
});

test("extractAttachmentText preserves large DOCX text extraction without silent truncation", () => {
  const largeDocxText = [
    "inicio do docx",
    "y".repeat(16_000),
    "fim-do-docx-nao-pode-sumir",
  ].join("\n");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document><w:body><w:p><w:r><w:t>${largeDocxText}</w:t></w:r></w:p></w:body></w:document>`;
  const docxBytes = zipSync({
    "word/document.xml": textEncoder.encode(documentXml),
  });

  const text = extractAttachmentText(
    { name: "relatorio.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    docxBytes,
  );

  assert.match(text, /inicio do docx/);
  assert.match(text, /fim-do-docx-nao-pode-sumir/);
  assert.equal(text.length, largeDocxText.length);
});
