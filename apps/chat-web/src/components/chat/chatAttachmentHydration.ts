import { refreshChatMessageAttachmentUrls } from "@/lib/chatAttachments";
import { refreshChatMessageArtifactUrls } from "@/lib/chatArtifacts";

type MessageLike = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export const hydrateChatMessages = async <TMessage extends MessageLike>(messages: TMessage[]) => {
  return await Promise.all(
    messages.map(async (message) => {
      const withAttachments = await refreshChatMessageAttachmentUrls(message.content).catch(() => message.content);
      const withArtifacts = await refreshChatMessageArtifactUrls(withAttachments).catch(() => withAttachments);
      return {
        ...message,
        content: withArtifacts,
      };
    }),
  );
};
