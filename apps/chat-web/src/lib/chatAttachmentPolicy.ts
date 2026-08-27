export const CHAT_PROXY_MAX_ATTACHMENTS = 4;
export const CHAT_COMPOSER_ACCEPTED_FILE_TYPES = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.md,.txt,.html,.htm,.css,.js,.json,.rtf";

export const CHAT_SUPPORTED_ATTACHMENT_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "md",
  "txt",
  "html",
  "htm",
  "css",
  "js",
  "json",
  "rtf",
];

export const CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "text/ecmascript",
  "application/ecmascript",
  "application/json",
  "application/rtf",
  "text/rtf",
];

const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(CHAT_SUPPORTED_ATTACHMENT_EXTENSIONS);
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES);

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  rtf: "application/rtf",
};

export const chatAttachmentStageLabel = () => "imagens, PDF e documentos";

export const normalizeChatAttachmentMimeType = (mimeType: string, extension: string) => {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (normalizedMimeType) {
    return normalizedMimeType;
  }

  const normalizedExtension = extension.trim().toLowerCase();
  return EXTENSION_TO_MIME_TYPE[normalizedExtension] ?? "";
};

export const isChatAttachmentSupportedInCurrentStage = (mimeType: string, extension: string) => {
  const normalizedMimeType = normalizeChatAttachmentMimeType(mimeType, extension);
  const normalizedExtension = extension.trim().toLowerCase();

  if (normalizedMimeType && SUPPORTED_ATTACHMENT_MIME_TYPES.has(normalizedMimeType)) {
    return true;
  }

  return SUPPORTED_ATTACHMENT_EXTENSIONS.has(normalizedExtension);
};

export const buildUnsupportedAttachmentMessage = (fileName: string) =>
  `${fileName} ainda nao e suportado no chat nesta etapa. Por enquanto, envie apenas ${chatAttachmentStageLabel()}.`;
