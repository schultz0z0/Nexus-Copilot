import { memo, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, Fragment, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  BriefcaseBusiness,
  ClipboardList,
  Image as ImageIcon,
  Paperclip,
  PenLine,
  Sparkles,
  Share2,
  Target,
  Mail,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { ChatMessageContent } from "./ChatMessageContent";
import { useAuth } from "@/contexts/AuthContext";
import { chatService } from "@/lib/chatService";
import {
  uploadChatAttachments,
  validateAttachmentFile,
} from "@/lib/chatAttachments";
import { CHAT_PROXY_MAX_ATTACHMENTS } from "@/lib/chatAttachmentPolicy";
import { buildChatProxyPayload } from "@/lib/chatProxyPayload";
import { shouldShowPendingAssistantIndicator } from "@/lib/chatStreamingUx";
import {
  createArtifactPart,
  createStatusPart,
  createTextPart,
  serializeChatMessageContent,
  type ChatMessageArtifactPart,
  type ChatMessageFilePart,
  type ChatMessagePart,
  type ChatMessageStatusPart,
} from "@/lib/chatMessageParts";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatEmptyState, type HomeTab } from "./ChatEmptyState";
import { ChatComposer, type ComposerAttachment, type ComposerMenuItem, type ImageGenerationOptions } from "./ChatComposer";
import { ApprovalModal } from "./chat/ApprovalModal";
import { useApprovalStream } from "./chat/useApprovalStream";
import { hydrateChatMessages } from "./chat/chatAttachmentHydration";
import { reconcileHydratedMessages } from "./chat/chatMessageReconciliation";
import { sendMessageToChatbotStream, type StreamArtifact, type StreamStatus } from "./chat/chatStreamClient";
import {
  getStreamingRenderChunkSize,
  getStreamingRenderFrameDelayMs,
} from "./chat/chatMessageRendering";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export type ChatExperience = "normal" | "picture";

interface ChatInterfaceProps {
  onRequestTabChange?: (tab: HomeTab) => void;
  experience?: ChatExperience;
  fixedSessionId?: string;
  pictureWorkspaceId?: string;
  hideHistory?: boolean;
  onActivitySettled?: () => void;
}

type ChatMessagesPaneProps = {
  activeStreamingMessageId: string | null;
  confidenceBadges: ReactNode;
  contextStatus: "ok" | "insufficient" | null;
  displayMessages: Message[];
  hasMoreHistory: boolean;
  isLoadingMore: boolean;
  isRetrievingContext: boolean;
  lastAssistantIndex: number;
  liveStatusText: string | null;
  messagesEndRef: RefObject<HTMLDivElement>;
  messagesScrollRef: RefObject<HTMLDivElement>;
  onLoadOlderMessages: () => void;
  scrollRequest: ChatScrollRequest;
  showPendingAssistantIndicator: boolean;
};

type ChatScrollRequest = {
  behavior: ScrollBehavior;
  settleLayout: boolean;
  version: number;
};

const ChatMessagesPane = memo(function ChatMessagesPane({
  activeStreamingMessageId,
  confidenceBadges,
  contextStatus,
  displayMessages,
  hasMoreHistory,
  isLoadingMore,
  isRetrievingContext,
  lastAssistantIndex,
  liveStatusText,
  messagesEndRef,
  messagesScrollRef,
  onLoadOlderMessages,
  scrollRequest,
  showPendingAssistantIndicator,
}: ChatMessagesPaneProps) {
  useLayoutEffect(() => {
    if (scrollRequest.version === 0) return;

    const scrollContainer = messagesScrollRef.current;
    if (!scrollContainer) return;

    const frameIds: number[] = [];
    const timeoutIds: number[] = [];
    const scrollToBottom = (behavior: ScrollBehavior) => {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior,
      });
    };

    scrollToBottom(scrollRequest.behavior);

    frameIds.push(window.requestAnimationFrame(() => {
      scrollToBottom(scrollRequest.behavior === "smooth" ? "auto" : scrollRequest.behavior);

      if (!scrollRequest.settleLayout) return;

      frameIds.push(window.requestAnimationFrame(() => scrollToBottom("auto")));
      timeoutIds.push(window.setTimeout(() => scrollToBottom("auto"), 120));
      timeoutIds.push(window.setTimeout(() => scrollToBottom("auto"), 320));
      timeoutIds.push(window.setTimeout(() => scrollToBottom("auto"), 700));
      timeoutIds.push(window.setTimeout(() => scrollToBottom("auto"), 1200));
      timeoutIds.push(window.setTimeout(() => scrollToBottom("auto"), 2000));
    }));

    return () => {
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [messagesScrollRef, scrollRequest]);

  return (
    <div ref={messagesScrollRef} className="space-y-6 overflow-y-auto overscroll-contain [overflow-anchor:none] p-4 md:p-8 flex-1 flex flex-col min-h-0">
      {(isRetrievingContext || (showPendingAssistantIndicator && liveStatusText)) && (
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-white/70 border border-white/40 px-3 py-2 rounded-full self-center animate-pulse">
          <Sparkles className="w-3 h-3 text-brand-primary" />
          <span>{liveStatusText ?? "Hermes está processando sua mensagem..."}</span>
        </div>
      )}

      {contextStatus === "insufficient" && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50/80 border border-amber-200/60 px-3 py-2 rounded-full self-center">
          <AlertCircle className="w-4 h-4" />
          <span>Contexto insuficiente. A IA fez uma pergunta de clarificação.</span>
        </div>
      )}

      {hasMoreHistory && (
        <div className="flex justify-center mb-4">
          <Button
            variant="ghost"
            onClick={onLoadOlderMessages}
            disabled={isLoadingMore}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            {isLoadingMore ? "Carregando..." : "Carregar mensagens anteriores"}
          </Button>
        </div>
      )}

      {displayMessages.map((message, index) => (
        <Fragment key={message.id}>
          {index === lastAssistantIndex && confidenceBadges}
          <div
            className={cn(
              "flex",
              message.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-6 py-4",
                message.role === "user" ? "chat-user-bubble text-white" : "glass-surface shadow-glass",
              )}
            >
              {message.role === "assistant" && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-brand-primary/20 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-brand-primary" />
                  </div>
                  <span className="text-xs font-medium text-text-muted">Nexus AI</span>
                </div>
              )}
              <ChatMessageContent
                role={message.role}
                content={message.content}
                isStreaming={message.id === activeStreamingMessageId}
              />
            </div>
          </div>
        </Fragment>
      ))}

      {showPendingAssistantIndicator && (
        <div className="flex justify-start">
          <div className="glass-surface rounded-2xl px-6 py-4 shadow-glass">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-brand-primary animate-bounce" />
              <div className="w-2 h-2 rounded-full bg-brand-primary animate-bounce delay-75" />
              <div className="w-2 h-2 rounded-full bg-brand-primary animate-bounce delay-150" />
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
});

export const ChatInterface = ({
  onRequestTabChange,
  experience = "normal",
  fixedSessionId,
  pictureWorkspaceId,
  hideHistory = false,
  onActivitySettled,
}: ChatInterfaceProps) => {
  const { user, session, signOut } = useAuth();
  const approvalBridgeBaseUrl = useMemo(() => chatService.resolveChatbotProxyBaseUrl() ?? "", []);
  const getApprovalAccessToken = useCallback(async () => session?.access_token ?? null, [session?.access_token]);
  const { currentRequest: approvalRequest, respond: respondToApproval } = useApprovalStream({
    bridgeBaseUrl: approvalBridgeBaseUrl,
    getAccessToken: getApprovalAccessToken,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSessionId = fixedSessionId ?? searchParams.get("chat");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [imageGenerationMode, setImageGenerationMode] = useState(false);
  const [imageGenerationOptions, setImageGenerationOptions] = useState<ImageGenerationOptions>({
    quality: "auto",
    size: "auto",
    outputFormat: "png",
  });
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isRetrievingContext, setIsRetrievingContext] = useState(false);
  const [liveStatusText, setLiveStatusText] = useState<string | null>(null);
  const [contextStatus, setContextStatus] = useState<"ok" | "insufficient" | null>(null);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);
  const [reviewState, setReviewState] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const pendingInitialScrollRef = useRef(false);
  const [scrollRequest, setScrollRequest] = useState<ChatScrollRequest>({
    behavior: "auto",
    settleLayout: false,
    version: 0,
  });
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingQueueRef = useRef("");
  const streamingRenderedContentRef = useRef("");
  const streamingFrameRef = useRef<number | null>(null);
  const streamingLastRenderAtRef = useRef(0);
  const [activeStreamingMessageId, setActiveStreamingMessageId] = useState<string | null>(null);
  
  // Session State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const PAGE_SIZE = 50;

  const isEmpty = messages.length === 0;
  const suggestionCards = useMemo(() => ([
    {
      icon: Share2,
      title: "Redes Sociais",
      desc: "Crie posts, legendas e stories virais",
      prompt: "Crie um calendário de conteúdo para Instagram focado em seguros...",
    },
    {
      icon: Target,
      title: "Estratégia",
      desc: "Planejamento mensal e análise de mercado",
      prompt: "Desenvolva uma estratégia de marketing mensal para corretora...",
    },
    {
      icon: Mail,
      title: "Campanha de E-mail",
      desc: "Newsletters e funis de venda automáticos",
      prompt: "Escreva uma sequência de e-mails para renovação de seguro...",
    },
    {
      icon: Search,
      title: "SEO & Blog",
      desc: "Artigos otimizados para busca orgânica",
      prompt: "Escreva um artigo de blog otimizado para SEO sobre seguro de vida...",
    },
  ]), []);

  const composerMenuItems = useMemo<ComposerMenuItem[]>(
    () => ([
      { key: "upload", label: "Adicionar fotos e arquivos", icon: Paperclip, kind: "upload", separatorAfter: true },
      {
        key: "image",
        label: "Criar imagem",
        icon: ImageIcon,
        kind: "action",
        onSelect: () => setImageGenerationMode(true),
        separatorAfter: true,
      },
      {
        key: "copy",
        label: "Criar Copy",
        icon: PenLine,
        kind: "action",
        onSelect: () => setInput("Crie 5 variações de copy (curta, direta e persuasiva) para: "),
      },
      {
        key: "sales",
        label: "Aux. de Vendas",
        icon: BriefcaseBusiness,
        kind: "action",
        onSelect: () => setInput("Me ajude a responder esse lead e fechar a venda. Contexto: "),
      },
      {
        key: "brief",
        label: "Briefing de peças",
        icon: ClipboardList,
        kind: "action",
        onSelect: () => setInput("Monte um briefing completo para uma peça. Informações: "),
      },
      {
        key: "plan",
        label: "Planejamento",
        icon: ClipboardList,
        kind: "action",
        onSelect: () => setInput("Crie um planejamento semanal de conteúdo para: "),
      },
    ].filter((item) => experience === "normal" || item.key === "upload")),
    [experience],
  );
  const displayMessages = useMemo(() => {
    const result: Message[] = [];
    for (const message of messages) {
      const previous = result[result.length - 1];
      if (previous && previous.role === message.role && previous.content === message.content) {
        continue;
      }
      result.push(message);
    }
    return result;
  }, [messages]);
  const lastAssistantIndex = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i -= 1) {
      if (displayMessages[i].role === "assistant") return i;
    }
    return -1;
  }, [displayMessages]);
  const showPendingAssistantIndicator = useMemo(
    () =>
      shouldShowPendingAssistantIndicator({
        isTyping,
        activeStreamingMessageId,
        messages: displayMessages,
      }),
    [activeStreamingMessageId, displayMessages, isTyping],
  );
  const chatbotProxyBaseUrl = (import.meta.env.VITE_CHATBOT_PROXY_URL ||
    import.meta.env.NEXT_PUBLIC_CHATBOT_PROXY_URL) as string | undefined;

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      // Se já tiver mensagens carregadas e for a mesma sessão (ex: navegação rápida), evita flash
      // Mas como não guardamos o ID no state messages, vamos carregar sempre para garantir sincronia
      const page = await chatService.getMessagesPage(sessionId, { limit: PAGE_SIZE });
      const dbMessages = page.messages;
      
      shouldAutoScrollRef.current = true;
      setHasMoreHistory(page.hasMore);
      const hydratedMessages = await hydrateChatMessages(
        dbMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        })),
      );
      setMessages((currentMessages) => {
        // Se o banco retornar vazio (ex: acabou de criar), não limpa mensagens otimistas.
        // Isso previne o "piscar" logo após criar o chat sem recriar o loader a cada render.
        if (dbMessages.length === 0 && currentMessages.length > 0) return currentMessages;

        return reconcileHydratedMessages({
          currentMessages,
          hydratedMessages,
          activeStreamingMessageId: streamingMessageIdRef.current,
        });
      });
    } catch (error) {
      console.error("Erro ao carregar mensagens:", error);
      toast.error("Erro ao carregar histórico da conversa.");
    }
  }, []);

  // Initialize or load session
  useEffect(() => {
    if (currentSessionId) {
      // Se tiver ID na URL, carrega as mensagens
      pendingInitialScrollRef.current = true;
      shouldAutoScrollRef.current = true;
      loadMessages(currentSessionId);
      // Abre a sidebar automaticamente no desktop para dar feedback visual
      if (!hideHistory && !fixedSessionId && window.innerWidth >= 1024) setIsHistoryOpen(true);
      
    } else {
      // Se não tiver ID (home), limpa as mensagens
      pendingInitialScrollRef.current = false;
      setMessages([]);
      setHasMoreHistory(false);
    }
    setIsRetrievingContext(false);
    setLiveStatusText(null);
    setContextStatus(null);
    setConfidenceScore(null);
    setReviewState(null);
  }, [currentSessionId, fixedSessionId, hideHistory, loadMessages]);

  useEffect(() => {
    if (!currentSessionId || isTyping) return;
    const lastMessage = displayMessages[displayMessages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") return;

    const intervalId = window.setInterval(() => {
      loadMessages(currentSessionId);
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [currentSessionId, displayMessages, isTyping, loadMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (!currentSessionId || isLoadingMore || !hasMoreHistory || messages.length === 0) return;

    const oldest = messages[0];
    setIsLoadingMore(true);
    try {
      const page = await chatService.getMessagesPage(currentSessionId, {
        limit: PAGE_SIZE,
        before: { created_at: oldest.created_at, id: oldest.id },
      });
      if (page.messages.length === 0) {
        setHasMoreHistory(false);
        return;
      }
      shouldAutoScrollRef.current = false;
      setHasMoreHistory(page.hasMore);
      setMessages((prev) => [...page.messages, ...prev]);
    } catch (error) {
      console.error("Erro ao carregar mensagens antigas:", error);
      toast.error("Erro ao carregar mensagens anteriores.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentSessionId, hasMoreHistory, isLoadingMore, messages]);

  const handleSelectSession = (sessionId: string) => {
    if (fixedSessionId) return;
    setSearchParams({ chat: sessionId });
  };

  const createNewSession = async () => {
    if (fixedSessionId) return;
    setSearchParams({}); // Remove o parâmetro chat da URL
    setMessages([]);
    setHasMoreHistory(false);
    if (window.innerWidth < 1024) setIsHistoryOpen(false);
  };

  const requestScrollToBottom = useCallback((behavior: ScrollBehavior = "smooth", settleLayout = false) => {
    setScrollRequest((current) => ({
      behavior,
      settleLayout,
      version: current.version + 1,
    }));
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      const isInitialScroll = pendingInitialScrollRef.current;
      requestScrollToBottom(
        activeStreamingMessageId || isInitialScroll ? "auto" : "smooth",
        isInitialScroll,
      );
      pendingInitialScrollRef.current = false;
    }
    shouldAutoScrollRef.current = true;
  }, [activeStreamingMessageId, messages, requestScrollToBottom]);

  const cancelStreamingRender = useCallback(() => {
    if (streamingFrameRef.current !== null) {
      window.cancelAnimationFrame(streamingFrameRef.current);
      streamingFrameRef.current = null;
    }
  }, []);

  const flushStreamingContent = useCallback((messageId: string, content: string) => {
    cancelStreamingRender();
    streamingMessageIdRef.current = messageId;
    streamingQueueRef.current = "";
    streamingRenderedContentRef.current = content;
    streamingLastRenderAtRef.current = 0;
    shouldAutoScrollRef.current = true;
    setMessages((prev) => prev.map((message) => (
      message.id === messageId
        ? { ...message, content }
        : message
    )));
  }, [cancelStreamingRender]);

  const pumpStreamingContent = useCallback((timestamp: number) => {
    const messageId = streamingMessageIdRef.current;
    if (!messageId) {
      cancelStreamingRender();
      return;
    }

    const queue = streamingQueueRef.current;
    if (!queue) {
      streamingFrameRef.current = null;
      return;
    }

    const elapsed = timestamp - streamingLastRenderAtRef.current;
    const minFrameMs = getStreamingRenderFrameDelayMs(queue.length);
    if (streamingLastRenderAtRef.current !== 0 && elapsed < minFrameMs) {
      streamingFrameRef.current = window.requestAnimationFrame(pumpStreamingContent);
      return;
    }

    streamingLastRenderAtRef.current = timestamp;

    const chunkSize = getStreamingRenderChunkSize(queue.length);
    const nextChunk = queue.slice(0, chunkSize);
    streamingQueueRef.current = queue.slice(chunkSize);
    streamingRenderedContentRef.current += nextChunk;
    shouldAutoScrollRef.current = true;

    setMessages((prev) => prev.map((message) => (
      message.id === messageId
        ? { ...message, content: streamingRenderedContentRef.current }
        : message
    )));

    if (streamingQueueRef.current) {
      streamingFrameRef.current = window.requestAnimationFrame(pumpStreamingContent);
    } else {
      streamingFrameRef.current = null;
    }
  }, [cancelStreamingRender]);

  const enqueueStreamingDelta = useCallback((messageId: string, delta: string) => {
    if (!delta) return;

    if (streamingMessageIdRef.current !== messageId) {
      cancelStreamingRender();
      streamingMessageIdRef.current = messageId;
      streamingQueueRef.current = "";
      streamingRenderedContentRef.current = "";
      streamingLastRenderAtRef.current = 0;
    }

    streamingQueueRef.current += delta;

    if (streamingFrameRef.current === null) {
      streamingFrameRef.current = window.requestAnimationFrame(pumpStreamingContent);
    }
  }, [cancelStreamingRender, pumpStreamingContent]);

  useEffect(() => {
    return () => {
      cancelStreamingRender();
    };
  }, [cancelStreamingRender]);

  const resolveChatbotProxyBaseUrl = () => {
    const raw = chatbotProxyBaseUrl?.trim();
    if (!raw) {
      throw new Error("VITE_CHATBOT_PROXY_URL nao configurada. Defina a URL da bridge.");
    }
    try {
      return new URL(raw).toString().replace(/\/$/, "");
    } catch {
      throw new Error("VITE_CHATBOT_PROXY_URL invalida.");
    }
  };

  const getAccessToken = async () => {
    if (session?.access_token) return session.access_token;
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new Error("Sessão inválida. Faça login novamente.");
    }
    return data.session.access_token;
  };

  const refreshAccessToken = async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) {
      return null;
    }
    return data.session.access_token;
  };

  const confidenceBadges = confidenceScore !== null && !isRetrievingContext && contextStatus === "ok" ? (
    <div className="flex items-center gap-2 self-center animate-in fade-in zoom-in duration-300 mb-4">
      <div className={cn(
        "flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border shadow-sm",
        confidenceScore >= 0.8 
          ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
          : confidenceScore >= 0.6 
            ? "bg-yellow-50 text-yellow-700 border-yellow-200"
            : "bg-red-50 text-red-700 border-red-200"
      )}>
          <Target className="w-3 h-3" />
          <span>
            Confiança: {Math.round(confidenceScore * 100)}% 
            {confidenceScore < 0.6 && " (Baixa)"}
          </span>
      </div>

      {reviewState && reviewState !== "clean" && (
        <div className={cn(
          "flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border shadow-sm",
            reviewState === "revised" 
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-orange-50 text-orange-700 border-orange-200"
        )}>
            <Sparkles className="w-3 h-3" />
            <span>
              {reviewState === "revised" ? "Resposta Revisada" : "Atenção na Revisão"}
            </span>
        </div>
      )}
    </div>
  ) : null;

  const createAttachmentId = () => {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const revokePreviewUrl = (url?: string) => {
    if (!url) return;
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  };

  const handlePickFiles = (files: FileList) => {
    const maxFiles = CHAT_PROXY_MAX_ATTACHMENTS;
    const selected = Array.from(files);

    const next: ComposerAttachment[] = [];
    for (const file of selected) {
      const validation = validateAttachmentFile(file);
      if (!validation.success) {
        toast.error("Anexo invalido", { description: validation.error });
        continue;
      }

      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      next.push({
        id: createAttachmentId(),
        file,
        previewUrl,
        kind: isImage ? "image" : "file",
      });
    }

    if (next.length === 0) return;

    setAttachments((prev) => {
      const combined = [...prev, ...next].slice(0, maxFiles);
      if (combined.length < prev.length + next.length) {
        toast.message("Limite de anexos", { description: `Máximo de ${maxFiles} anexos por mensagem.` });
        for (const removed of [...prev, ...next].slice(combined.length)) revokePreviewUrl(removed.previewUrl);
      }
      return combined;
    });
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      revokePreviewUrl(target?.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const uploadAttachments = async (sessionId: string) => {
    if (!user) return { storedParts: [] as ChatMessageFilePart[] };
    if (attachments.length === 0) return { storedParts: [] as ChatMessageFilePart[] };

    setIsUploadingAttachments(true);
    try {
      const uploaded = await uploadChatAttachments({
        attachments,
        sessionId,
        userId: user.id,
      });
      for (const att of attachments) revokePreviewUrl(att.previewUrl);
      setAttachments([]);
      return uploaded;
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const handleSend = async (submittedInput?: string) => {
    const effectiveInput = typeof submittedInput === "string" ? submittedInput : input;
    if ((!effectiveInput.trim() && attachments.length === 0) || !user || isUploadingAttachments) return;

    const currentInput = effectiveInput;
    const currentImageGenerationMode = imageGenerationMode;
    const currentImageGenerationOptions = imageGenerationOptions;
    setInput("");

    let activeSessionId = currentSessionId;
    let assistantTempId: string | null = null;
    let assistantContent = "";
    const assistantFiles: ChatMessageFilePart[] = [];
    const assistantArtifacts: ChatMessageArtifactPart[] = [];
    let receivedFirstDelta = false;
    let persistedUserMessage = false;

    try {
      if (!activeSessionId) {
        const titleBase = currentInput.trim()
          ? currentInput.trim()
          : attachments[0]?.file.name
            ? `Arquivo: ${attachments[0].file.name}`
            : "Nova conversa";
        const newSession = await chatService.createSession(user.id, titleBase.slice(0, 30) + "...");
        activeSessionId = newSession.id;
        if (!fixedSessionId) setSearchParams({ chat: activeSessionId });
      }

      if (!activeSessionId) {
        throw new Error("Sessão inválida do chat.");
      }

      const { storedParts } = await uploadAttachments(activeSessionId);
      const userMessageParts: ChatMessagePart[] = [];
      if (currentInput.trim()) {
        userMessageParts.push(createTextPart(currentInput.trim()));
      }
      userMessageParts.push(...storedParts);

      const messageForStorage = serializeChatMessageContent(userMessageParts);
      const proxyPayload = buildChatProxyPayload({
        sessionId: activeSessionId,
        messageText: currentInput.trim(),
        attachments: storedParts,
        imageGeneration: currentImageGenerationMode ? currentImageGenerationOptions : null,
        experience,
        pictureWorkspaceId,
      });
      if (!proxyPayload.message_text && !proxyPayload.attachments?.length && !messageForStorage) return;

      setIsTyping(true);
      setIsRetrievingContext(true);
      setLiveStatusText("Hermes está preparando a resposta...");
      setContextStatus(null);
      setConfidenceScore(null);
      setReviewState(null);

      const tempId = Date.now().toString();
      setMessages((prev) => [...prev, {
        id: tempId,
        role: "user",
        content: messageForStorage || proxyPayload.message_text,
        created_at: new Date().toISOString(),
      }]);

      await chatService.addMessage(activeSessionId, "user", messageForStorage || proxyPayload.message_text);
      persistedUserMessage = true;

      const assistantId = (Date.now() + 1).toString();
      assistantTempId = assistantId;
      setActiveStreamingMessageId(assistantId);
      streamingMessageIdRef.current = assistantId;
      streamingQueueRef.current = "";
      streamingRenderedContentRef.current = "";
      streamingLastRenderAtRef.current = 0;
      cancelStreamingRender();
      setMessages((prev) => [...prev, {
        id: assistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      }]);

      await sendMessageToChatbotStream({
        payload: proxyPayload,
        getAccessToken,
        refreshAccessToken,
        signOut,
        resolveChatbotProxyBaseUrl,
        onDelta: (delta) => {
          assistantContent += delta;
          if (!receivedFirstDelta) {
            receivedFirstDelta = true;
            setIsRetrievingContext(false);
            setLiveStatusText(null);
          }
          enqueueStreamingDelta(assistantId, delta);
        },
        onMeta: (meta) => {
          if (meta.context_status === "refining") {
            return;
          }
          setIsRetrievingContext(false);

          if (meta.context_status === "insufficient") {
            setContextStatus("insufficient");
          } else if (meta.context_status === "ok") {
            setContextStatus("ok");
          }

          if (typeof meta.confidence_score === "number") {
            setConfidenceScore(meta.confidence_score as number);
          }
          if (typeof meta.review_state === "string") {
            setReviewState(meta.review_state as string);
          }
        },
        onStatus: (status) => {
          setLiveStatusText(status.text);
        },
        onFiles: (files) => {
          files.forEach((file) => {
            if (!assistantFiles.some((existing) => existing.url === file.url && existing.name === file.name)) {
              assistantFiles.push(file);
            }
          });
        },
        onArtifact: (artifact) => {
          const nextArtifact = createArtifactPart(artifact);
          if (
            !assistantArtifacts.some((existing) => (
              existing.title === nextArtifact.title &&
              existing.content === nextArtifact.content &&
              existing.artifactType === nextArtifact.artifactType
            ))
          ) {
            assistantArtifacts.push(nextArtifact);
          }
        },
      });

      if (!assistantContent.trim() && assistantFiles.length === 0 && assistantArtifacts.length === 0) {
        throw new Error("Resposta vazia da IA.");
      }

      const assistantParts: ChatMessagePart[] = [];
      if (assistantContent.trim()) assistantParts.push(createTextPart(assistantContent));
      assistantParts.push(...assistantFiles);
      assistantParts.push(...assistantArtifacts);

      const finalAssistantContent = serializeChatMessageContent(assistantParts) || assistantContent;
      flushStreamingContent(assistantId, finalAssistantContent);
      await chatService.addMessage(activeSessionId, "assistant", finalAssistantContent);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      const errorContent = assistantContent
        ? `${assistantContent}\n\n⚠️ **Erro de Conexão**: O Nexus AI está analisando muitos documentos agora ou houve uma falha na rede. Por favor, tente perguntar novamente em alguns instantes.`
        : "⚠️ **Erro de Conexão**: O Nexus AI está analisando muitos documentos agora ou houve uma falha na rede. Por favor, tente perguntar novamente em alguns instantes.";

      if (assistantTempId) {
        flushStreamingContent(assistantTempId, errorContent);
      } else {
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: errorContent,
          created_at: new Date().toISOString(),
        }]);
      }

      if (!persistedUserMessage) {
        setInput(currentInput);
      }
      toast.error(errorMessage);
    } finally {
      streamingMessageIdRef.current = null;
      streamingQueueRef.current = "";
      streamingRenderedContentRef.current = "";
      cancelStreamingRender();
      setActiveStreamingMessageId(null);
      setIsTyping(false);
      setIsRetrievingContext(false);
      setLiveStatusText(null);
      onActivitySettled?.();
    }
  };

  return (
    <div className="flex h-full min-h-0 relative">
      {/* Sidebar de Histórico */}
      {!hideHistory && !fixedSessionId && (
        <ChatHistorySidebar
          isOpen={isHistoryOpen}
          onToggle={() => setIsHistoryOpen(!isHistoryOpen)}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onNewChat={createNewSession}
        />
      )}

      <div
        className={cn(
          "flex-1 flex flex-col transition-all duration-300 ml-0 h-full min-h-0",
          !hideHistory && !fixedSessionId
            ? (isHistoryOpen ? "md:ml-64" : "md:ml-12")
            : "",
          isEmpty ? "overflow-y-auto" : "overflow-hidden",
        )}
      >
        <div
          className={cn(
            "max-w-5xl mx-auto flex flex-col w-full",
            isEmpty ? "min-h-full" : "h-full min-h-0",
          )}
        >
          {isEmpty && experience === "picture" ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-8">
              <div className="max-w-lg text-center">
                <h2 className="text-xl font-semibold text-slate-900">O que vamos criar?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Conte ao Hermes sobre a peça e anexe referências quando precisar. Ele organiza o briefing e conduz a geração no Picture.</p>
              </div>
              <div className="w-full max-w-3xl">
                <ChatComposer
                  value={input}
                  onSubmit={handleSend}
                  placeholder="Descreva a peça, objetivo, público e formato..."
                  attachments={attachments}
                  menuItems={composerMenuItems}
                  imageGenerationMode={false}
                  imageGenerationOptions={imageGenerationOptions}
                  onImageGenerationOptionsChange={setImageGenerationOptions}
                  onExitImageGenerationMode={() => setImageGenerationMode(false)}
                  onPickFiles={handlePickFiles}
                  onRemoveAttachment={handleRemoveAttachment}
                  disabled={isTyping || isUploadingAttachments}
                />
              </div>
            </div>
          ) : isEmpty ? (
            <ChatEmptyState
              input={input}
              onInputChange={setInput}
              onSubmit={handleSend}
              suggestionCards={suggestionCards}
              attachments={attachments}
              menuItems={composerMenuItems}
              imageGenerationMode={imageGenerationMode}
              imageGenerationOptions={imageGenerationOptions}
              onImageGenerationOptionsChange={setImageGenerationOptions}
              onExitImageGenerationMode={() => setImageGenerationMode(false)}
              onPickFiles={handlePickFiles}
              onRemoveAttachment={handleRemoveAttachment}
            />
          ) : (
            <ChatMessagesPane
              activeStreamingMessageId={activeStreamingMessageId}
              confidenceBadges={confidenceBadges}
              contextStatus={contextStatus}
              displayMessages={displayMessages}
              hasMoreHistory={hasMoreHistory}
              isLoadingMore={isLoadingMore}
              isRetrievingContext={isRetrievingContext}
              lastAssistantIndex={lastAssistantIndex}
              liveStatusText={liveStatusText}
              messagesEndRef={messagesEndRef}
              messagesScrollRef={messagesScrollRef}
              onLoadOlderMessages={loadOlderMessages}
              scrollRequest={scrollRequest}
              showPendingAssistantIndicator={showPendingAssistantIndicator}
            />
          )}

          {!isEmpty && (
            <div className="shrink-0 [overflow-anchor:none] px-4 md:px-8 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <ChatComposer
                value={input}
                onSubmit={handleSend}
                placeholder={experience === "picture" ? "Continue refinando a peça com o Hermes..." : "Diga o que você quer criar hoje para sua marca..."}
                attachments={attachments}
                menuItems={composerMenuItems}
                imageGenerationMode={imageGenerationMode}
                imageGenerationOptions={imageGenerationOptions}
                onImageGenerationOptionsChange={setImageGenerationOptions}
                onExitImageGenerationMode={() => setImageGenerationMode(false)}
                onPickFiles={handlePickFiles}
                onRemoveAttachment={handleRemoveAttachment}
                disabled={isTyping || isUploadingAttachments}
              />
            </div>
          )}
        </div>
      </div>
      <ApprovalModal
        request={approvalRequest}
        onRespond={respondToApproval}
      />
    </div>
  );
};
