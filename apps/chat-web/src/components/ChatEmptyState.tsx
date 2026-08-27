import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Mascot } from "./Mascot";
import { ChatComposer, type ComposerAttachment, type ComposerMenuItem, type ImageGenerationOptions } from "./ChatComposer";

export type HomeTab = "chat" | "image";

type SuggestionCard = {
  title: string;
  desc: string;
  icon: LucideIcon;
  prompt: string;
};

interface ChatEmptyStateProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  suggestionCards: SuggestionCard[];
  attachments: ComposerAttachment[];
  menuItems: ComposerMenuItem[];
  imageGenerationMode?: boolean;
  imageGenerationOptions?: ImageGenerationOptions;
  onImageGenerationOptionsChange?: (options: ImageGenerationOptions) => void;
  onExitImageGenerationMode?: () => void;
  onPickFiles: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
}

export function ChatEmptyState({
  input,
  onInputChange,
  onSubmit,
  suggestionCards,
  attachments,
  menuItems,
  imageGenerationMode,
  imageGenerationOptions,
  onImageGenerationOptionsChange,
  onExitImageGenerationMode,
  onPickFiles,
  onRemoveAttachment,
}: ChatEmptyStateProps) {
  const focusInputSoon = () => {
    window.setTimeout(() => document.getElementById("chat-composer-message")?.focus(), 0);
  };

  const setPrompt = (prompt: string) => {
    onInputChange(prompt);
    focusInputSoon();
  };

  return (
    <div className={cn(
      "min-h-full flex flex-col items-center justify-start lg:justify-center w-full px-4 py-6 sm:py-8 gap-8 md:gap-10",
      "[@media(max-height:820px)]:py-4 [@media(max-height:820px)]:gap-4 [@media(max-height:820px)]:lg:justify-start",
    )}>
      <div className="flex flex-col items-center text-center max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-700">
        <Mascot />
        <div className={cn("mt-8 space-y-4", "[@media(max-height:820px)]:mt-4 [@media(max-height:820px)]:space-y-3")}>
          <h2 className={cn("text-3xl md:text-5xl font-bold text-text-primary tracking-tight", "[@media(max-height:820px)]:md:text-4xl")}>
            Inteligência que conhece o mercado de seguros.
          </h2>
          <p className={cn(
            "text-base sm:text-lg md:text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed",
            "[@media(max-height:820px)]:md:text-lg",
          )}>
            Crie estratégias, redações e peças visuais em segundos com a curadoria da ENS.
          </p>
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200",
          "hidden md:grid [@media(max-height:820px)]:hidden",
        )}
      >
        {suggestionCards.map((card) => (
          <button
            key={card.title}
            onClick={() => setPrompt(card.prompt)}
            className="text-left glass-surface p-4 rounded-2xl hover:bg-white/60 transition-all hover:scale-[1.01] group border border-white/20 hover:border-brand-primary/30 shadow-sm hover:shadow-lg"
          >
            <div className="flex items-start gap-4">
              <div className="bg-brand-primary/10 p-3 rounded-xl group-hover:bg-brand-primary/20 transition-colors shrink-0">
                <card.icon className="w-5 h-5 text-brand-primary" />
              </div>
              <div className="flex flex-col">
                <h3 className="font-semibold text-text-primary text-sm">{card.title}</h3>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed">{card.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className={cn("w-full max-w-3xl pb-[calc(env(safe-area-inset-bottom)+1rem)]", "[@media(max-height:820px)]:pb-[calc(env(safe-area-inset-bottom)+0.5rem)]")}>
        <ChatComposer
          value={input}
          onSubmit={onSubmit}
          placeholder="Diga o que você quer criar hoje para sua marca..."
          attachments={attachments}
          imageGenerationMode={imageGenerationMode}
          imageGenerationOptions={imageGenerationOptions}
          onImageGenerationOptionsChange={onImageGenerationOptionsChange}
          onExitImageGenerationMode={onExitImageGenerationMode}
          onPickFiles={onPickFiles}
          onRemoveAttachment={onRemoveAttachment}
          menuItems={menuItems}
        />
      </div>
    </div>
  );
}
