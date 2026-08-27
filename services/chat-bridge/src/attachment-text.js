import { unzipSync } from "fflate";

const getFileExtension = (fileName) => {
  const parts = String(fileName ?? "").toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
};

const normalizeExtractedText = (value) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\0")
    .join("")
    .trim();

const decodeUtf8 = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);
const decodeLatin1 = (bytes) => new TextDecoder("latin1").decode(bytes);

const decodeXmlEntities = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#9;/g, "\t");

const extractPdfText = (bytes) => {
  const decoded = decodeLatin1(bytes);
  const literalMatches = [...decoded.matchAll(/\(([^()]*)\)\s*Tj/g)].map((match) => match[1]);
  const joinedLiteral = literalMatches.join(" ");

  const fallbackText = (joinedLiteral || decoded)
    .replace(/[^\x20-\x7E\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeExtractedText(fallbackText);
};

const extractPlainText = (bytes) => normalizeExtractedText(decodeUtf8(bytes));

const extractRtfText = (bytes) => {
  const decoded = decodeLatin1(bytes);
  const normalized = decoded
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{2,}/g, "\n");

  return normalizeExtractedText(normalized);
};

const extractDocxText = (bytes) => {
  const archive = unzipSync(bytes);
  const xmlEntries = Object.entries(archive)
    .filter(([entryPath]) => entryPath === "word/document.xml" || /^word\/(header|footer)\d+\.xml$/i.test(entryPath))
    .map(([, content]) => decodeUtf8(content));

  const text = xmlEntries
    .map((xml) =>
      xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, value) => decodeXmlEntities(value))
        .replace(/<[^>]+>/g, ""),
    )
    .join("\n")
    .replace(/\n{2,}/g, "\n");

  return normalizeExtractedText(text);
};

const stripXml = (xml) => decodeXmlEntities(String(xml ?? "").replace(/<[^>]+>/g, " "));

const extractPptxText = (bytes) => {
  const archive = unzipSync(bytes);
  const slideEntries = Object.entries(archive)
    .filter(([entryPath]) => /^ppt\/slides\/slide\d+\.xml$/i.test(entryPath))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([entryPath, content]) => {
      const slideNumber = entryPath.match(/slide(\d+)\.xml/i)?.[1] ?? "?";
      const xml = decodeUtf8(content);
      const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlEntities(match[1]))
        .join(" ")
        .trim();
      return text ? `[Slide ${slideNumber}] ${text}` : "";
    })
    .filter(Boolean);

  if (slideEntries.length > 0) return normalizeExtractedText(slideEntries.join("\n"));

  const xmlEntries = Object.entries(archive)
    .filter(([entryPath]) => entryPath.startsWith("ppt/") && entryPath.endsWith(".xml"))
    .map(([, content]) => stripXml(decodeUtf8(content)));

  return normalizeExtractedText(xmlEntries.join("\n"));
};

const extractSharedStrings = (xml) => (
  [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    const fragments = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXmlEntities(item[1]));
    return fragments.join("");
  })
);

const getColumnIndex = (cellRef) => {
  const letters = String(cellRef ?? "").replace(/\d+/g, "").toUpperCase();
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
};

const extractXlsxText = (bytes) => {
  const archive = unzipSync(bytes);
  const workbookXml = archive["xl/workbook.xml"] ? decodeUtf8(archive["xl/workbook.xml"]) : "";
  const workbookRelsXml = archive["xl/_rels/workbook.xml.rels"] ? decodeUtf8(archive["xl/_rels/workbook.xml.rels"]) : "";
  const sharedStrings = archive["xl/sharedStrings.xml"] ? extractSharedStrings(decodeUtf8(archive["xl/sharedStrings.xml"])) : [];

  const relMap = new Map(
    [...workbookRelsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((match) => [
      match[1],
      match[2].replace(/^\/+/, ""),
    ]),
  );

  const sheets = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((match) => ({
    name: decodeXmlEntities(match[1]),
    target: relMap.get(match[2]),
  }));

  const sheetOutputs = sheets
    .map((sheet) => {
      if (!sheet.target) return "";
      const sheetPath = sheet.target.startsWith("xl/") ? sheet.target : `xl/${sheet.target}`;
      const sheetXmlBytes = archive[sheetPath];
      if (!sheetXmlBytes) return "";
      const sheetXml = decodeUtf8(sheetXmlBytes);

      const rows = [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
        const cells = [...rowMatch[1].matchAll(/<c[^>]*r="([^"]+)"([^>]*)>([\s\S]*?)<\/c>/g)];
        const values = new Map();

        cells.forEach((cellMatch) => {
          const cellRef = cellMatch[1];
          const attributes = cellMatch[2];
          const body = cellMatch[3];
          const columnIndex = getColumnIndex(cellRef);
          const shared = /t="s"/.test(attributes);
          const inline = /t="inlineStr"/.test(attributes);
          const value = inline
            ? decodeXmlEntities((body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ""))
            : body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";

          values.set(columnIndex, shared ? sharedStrings[Number(value)] ?? "" : decodeXmlEntities(value));
        });

        const width = Math.max(...Array.from(values.keys()), -1) + 1;
        return Array.from({ length: width }, (_, index) => values.get(index) ?? "").join("\t").trimEnd();
      });

      const table = rows.filter(Boolean).join("\n");
      return table ? [`[Planilha: ${sheet.name}]`, table].join("\n") : "";
    })
    .filter(Boolean);

  return normalizeExtractedText(sheetOutputs.join("\n\n"));
};

const extractBinaryText = (bytes) => {
  const decoded = decodeLatin1(bytes);
  const matches = decoded.match(/[A-Za-z0-9][\x20-\x7E]{3,}/g) ?? [];
  return normalizeExtractedText(matches.join("\n"));
};

export const extractAttachmentText = (attachment, bytes) => {
  const mimeType = String(attachment.mime_type ?? "").trim().toLowerCase();
  const extension = getFileExtension(attachment.name);

  if (mimeType.startsWith("image/")) return "";
  if (mimeType === "application/pdf" || extension === "pdf") return extractPdfText(bytes);

  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/csv" ||
    mimeType === "text/css" ||
    mimeType === "text/javascript" ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-javascript" ||
    mimeType === "text/ecmascript" ||
    mimeType === "application/ecmascript" ||
    mimeType === "application/json" ||
    extension === "js" ||
    extension === "css" ||
    extension === "html" ||
    extension === "htm" ||
    extension === "txt" ||
    extension === "md" ||
    extension === "csv" ||
    extension === "json"
  ) {
    return extractPlainText(bytes);
  }

  if (mimeType === "application/rtf" || mimeType === "text/rtf" || extension === "rtf") return extractRtfText(bytes);

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === "docx") {
    return extractDocxText(bytes);
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || extension === "xlsx") {
    return extractXlsxText(bytes);
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || extension === "pptx") {
    return extractPptxText(bytes);
  }

  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    extension === "doc" ||
    extension === "xls" ||
    extension === "ppt"
  ) {
    return extractBinaryText(bytes);
  }

  return "";
};
