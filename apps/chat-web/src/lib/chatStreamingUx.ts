type StreamUxMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type PendingAssistantIndicatorParams = {
  isTyping: boolean;
  activeStreamingMessageId: string | null;
  messages: StreamUxMessage[];
};

const hasRenderableAssistantContent = (content: string) => content.trim().length > 0;

export const shouldShowPendingAssistantIndicator = ({
  isTyping,
  activeStreamingMessageId,
  messages,
}: PendingAssistantIndicatorParams) => {
  if (activeStreamingMessageId) {
    const activeAssistantMessage = messages.find(
      (message) => message.id === activeStreamingMessageId && message.role === "assistant",
    );

    if (!activeAssistantMessage) {
      return true;
    }

    return !hasRenderableAssistantContent(activeAssistantMessage.content);
  }

  return isTyping;
};
