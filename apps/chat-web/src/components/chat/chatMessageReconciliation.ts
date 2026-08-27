export type ReconciledChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

const areMessagesEquivalent = (left: ReconciledChatMessage, right: ReconciledChatMessage) => {
  return left.role === right.role && left.content === right.content;
};

export const reconcileHydratedMessages = ({
  currentMessages,
  hydratedMessages,
  activeStreamingMessageId,
}: {
  currentMessages: ReconciledChatMessage[];
  hydratedMessages: ReconciledChatMessage[];
  activeStreamingMessageId: string | null;
}) => {
  if (!activeStreamingMessageId) {
    return hydratedMessages;
  }

  const optimisticStreamingMessage = currentMessages.find((message) => message.id === activeStreamingMessageId);
  if (!optimisticStreamingMessage) {
    return hydratedMessages;
  }

  const alreadyPersisted = hydratedMessages.some((message) => areMessagesEquivalent(message, optimisticStreamingMessage));
  if (alreadyPersisted) {
    return hydratedMessages;
  }

  return [...hydratedMessages, optimisticStreamingMessage];
};
