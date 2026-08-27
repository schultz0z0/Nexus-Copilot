type DownloadChatFileParams = {
  url: string;
  fileName: string;
  fetchImpl?: typeof fetch;
  documentRef?: Document;
  urlApi?: typeof URL;
};

export const downloadChatFile = async ({
  url,
  fileName,
  fetchImpl = fetch,
  documentRef = document,
  urlApi = URL,
}: DownloadChatFileParams) => {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`download_failed:${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = urlApi.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener noreferrer";
  documentRef.body.appendChild(link);

  try {
    link.click();
  } finally {
    link.remove();
    urlApi.revokeObjectURL(objectUrl);
  }
};
