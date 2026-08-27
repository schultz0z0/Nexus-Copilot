import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHAT_COMPOSER_ACCEPTED_FILE_TYPES } from "@/lib/chatAttachmentPolicy";
import { Check, ChevronDown, FileText, Image as ImageIcon, Mic, Plus, Send, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getComposerTextareaLayout } from "./chatComposerTextarea";

export type ComposerMenuItem =
  | {
      key: string;
      label: string;
      icon: LucideIcon;
      kind: "action";
      onSelect: () => void;
      separatorAfter?: boolean;
    }
  | {
      key: "upload";
      label: string;
      icon: LucideIcon;
      kind: "upload";
      separatorAfter?: boolean;
    };

export type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  kind: "image" | "file";
};

export type ImageGenerationQuality = "auto" | "low" | "medium" | "high";
export type ImageGenerationSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "1152x2048"
  | "2560x1440"
  | "1440x2560"
  | "3840x2160"
  | "2160x3840";
export type ImageGenerationOutputFormat = "png" | "jpeg" | "webp";

export type ImageGenerationOptions = {
  quality: ImageGenerationQuality;
  size: ImageGenerationSize;
  outputFormat: ImageGenerationOutputFormat;
};

type ChatComposerProps = {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  attachments: ComposerAttachment[];
  menuItems: ComposerMenuItem[];
  imageGenerationMode?: boolean;
  imageGenerationOptions?: ImageGenerationOptions;
  onImageGenerationOptionsChange?: (options: ImageGenerationOptions) => void;
  onExitImageGenerationMode?: () => void;
  onSubmit: (value: string) => void;
  onPickFiles: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onClickMic?: () => void;
  className?: string;
};

const maxComposerTextareaHeight = 240;

const qualityOptions: Array<{ value: ImageGenerationQuality; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Media" },
  { value: "low", label: "Baixa" },
];

const sizeOptions: Array<{ value: ImageGenerationSize; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "Quadrado 1024" },
  { value: "1024x1536", label: "Retrato 1024x1536" },
  { value: "1536x1024", label: "Paisagem 1536x1024" },
  { value: "2560x1440", label: "2K 2560x1440" },
  { value: "3840x2160", label: "4K 3840x2160" },
];

const outputFormatOptions: Array<{ value: ImageGenerationOutputFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

type OptionMenuProps<T extends string> = {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
};

function OptionMenu<T extends string>({ label, value, options, disabled, onChange }: OptionMenuProps<T>) {
  const selected = options.find((option) => option.value === value)?.label ?? value;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-full border border-white/30 bg-white/35 px-3 text-xs font-medium text-slate-700 hover:bg-white/50"
          disabled={disabled}
        >
          <span className="max-w-[120px] truncate">{label}: {selected}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="glass-surface border-white/20 bg-white/80 backdrop-blur-md shadow-glass min-w-[190px]">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={(event) => {
              event.preventDefault();
              onChange(option.value);
            }}
            className="cursor-pointer justify-between"
          >
            <span>{option.label}</span>
            {option.value === value && <Check className="h-4 w-4 text-brand-primary" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChatComposer({
  value,
  placeholder = "Pergunte alguma coisa...",
  disabled,
  attachments,
  menuItems,
  imageGenerationMode = false,
  imageGenerationOptions,
  onImageGenerationOptionsChange,
  onExitImageGenerationMode,
  onSubmit,
  onPickFiles,
  onRemoveAttachment,
  onClickMic,
  className,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const previousValueLengthRef = useRef(0);
  const previousExternalValueRef = useRef(value);
  const [draftValue, setDraftValue] = useState(value);
  const [isDragActive, setIsDragActive] = useState(false);
  const canSend = useMemo(() => draftValue.trim().length > 0 || attachments.length > 0, [attachments.length, draftValue]);
  const canEditImageOptions = imageGenerationMode && imageGenerationOptions && onImageGenerationOptionsChange;

  useEffect(() => {
    if (value === previousExternalValueRef.current) return;
    previousExternalValueRef.current = value;
    previousValueLengthRef.current = 0;
    setDraftValue(value);
  }, [value]);

  const handleOpenFilePicker = () => {
    fileInputRef.current?.click();
  };

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (draftValue.length < previousValueLengthRef.current || draftValue.length === 0) {
      textarea.style.height = "auto";
    }
    const layout = getComposerTextareaLayout({
      scrollHeight: textarea.scrollHeight,
      currentHeight: textarea.style.height,
      currentOverflowY: textarea.style.overflowY,
      maxHeight: maxComposerTextareaHeight,
    });
    if (layout) {
      textarea.style.height = layout.height;
      textarea.style.overflowY = layout.overflowY;
    }
    previousValueLengthRef.current = draftValue.length;
  }, [draftValue.length]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(resizeTextarea);
    return () => window.cancelAnimationFrame(frameId);
  }, [resizeTextarea]);

  const handleSubmit = useCallback(() => {
    if (!canSend || disabled) return;
    const submittedValue = draftValue;
    setDraftValue("");
    previousExternalValueRef.current = "";
    previousValueLengthRef.current = 0;
    onSubmit(submittedValue);
  }, [canSend, disabled, draftValue, onSubmit]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleFilesFromDataTransfer = useCallback((files: FileList | null) => {
    if (!files || files.length === 0 || disabled) return;
    onPickFiles(files);
  }, [disabled, onPickFiles]);

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = () => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragActive(false);
    handleFilesFromDataTransfer(event.dataTransfer.files);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    handleFilesFromDataTransfer(files);
  };

  return (
    <div
      className={cn(
        "glass-surface chat-composer-radiant rounded-3xl p-4 shadow-glass relative overflow-hidden transition-all",
        isDragActive && "ring-2 ring-brand-primary/60 bg-brand-primary/5",
        className,
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        id="chat-composer-file-upload"
        name="chat-composer-file-upload"
        type="file"
        accept={CHAT_COMPOSER_ACCEPTED_FILE_TYPES}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          onPickFiles(files);
          e.currentTarget.value = "";
        }}
      />

      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-brand-primary/50 bg-white/65 backdrop-blur-sm">
          <p className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-slate-800 shadow-sm">
            Solte seus arquivos aqui para anexar ao chat
          </p>
        </div>
      )}

      {imageGenerationMode && imageGenerationOptions && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-3 text-xs font-semibold text-slate-800">
            <ImageIcon className="h-4 w-4 text-brand-primary" aria-hidden="true" />
            <span>Gerar imagem</span>
          </div>

          <OptionMenu
            label="Tamanho"
            value={imageGenerationOptions.size}
            options={sizeOptions}
            disabled={disabled || !canEditImageOptions}
            onChange={(size) => onImageGenerationOptionsChange?.({ ...imageGenerationOptions, size })}
          />

          <OptionMenu
            label="Qualidade"
            value={imageGenerationOptions.quality}
            options={qualityOptions}
            disabled={disabled || !canEditImageOptions}
            onChange={(quality) => onImageGenerationOptionsChange?.({ ...imageGenerationOptions, quality })}
          />

          <OptionMenu
            label="Formato"
            value={imageGenerationOptions.outputFormat}
            options={outputFormatOptions}
            disabled={disabled || !canEditImageOptions}
            onChange={(outputFormat) => onImageGenerationOptionsChange?.({ ...imageGenerationOptions, outputFormat })}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Sair do modo gerar imagem"
            className="h-9 w-9 rounded-full border border-white/30 bg-white/30 hover:bg-white/50"
            onClick={onExitImageGenerationMode}
            disabled={disabled}
          >
            <X className="h-4 w-4 text-slate-700" aria-hidden="true" />
          </Button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 rounded-2xl border border-white/20 bg-white/30 px-2 py-2 shadow-sm"
            >
              {att.kind === "image" && att.previewUrl ? (
                <div className="h-12 w-12 overflow-hidden rounded-xl border border-white/30 bg-white/30">
                  <img src={att.previewUrl} alt={att.file.name} className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="h-12 w-12 grid place-items-center rounded-xl border border-white/30 bg-white/20">
                  <FileText className="h-5 w-5 text-slate-700" aria-hidden="true" />
                </div>
              )}

              <div className="min-w-0">
                <p className="max-w-[180px] truncate text-xs font-medium text-slate-800">{att.file.name}</p>
                <p className="text-[10px] text-slate-600">
                  {att.kind === "image" ? "Imagem" : "Arquivo"} • {(att.file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover ${att.file.name}`}
                className="h-9 w-9 rounded-full hover:bg-white/40"
                onClick={() => onRemoveAttachment(att.id)}
              >
                <X className="h-4 w-4 text-slate-700" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Abrir ações rápidas"
              type="button"
              variant="ghost"
              size="icon"
              className="w-10 h-10 rounded-full glass-surface hover:scale-105 transition-transform"
              disabled={disabled}
            >
              <Plus className="w-5 h-5 text-text-muted" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className="glass-surface border-white/20 bg-white/40 backdrop-blur-md shadow-glass min-w-[260px]"
          >
            {menuItems.map((item) => {
              const content = (
                <DropdownMenuItem
                  key={item.key}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (disabled) return;
                    if (item.kind === "upload") handleOpenFilePicker();
                    else item.onSelect();
                  }}
                  className="cursor-pointer"
                >
                  <item.icon className="mr-2 h-4 w-4 text-slate-700" aria-hidden="true" />
                  {item.label}
                </DropdownMenuItem>
              );

              return item.separatorAfter ? (
                <div key={`${item.key}-wrap`}>
                  {content}
                  <DropdownMenuSeparator className="bg-white/20" />
                </div>
              ) : (
                content
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Textarea
          ref={textareaRef}
          id="chat-composer-message"
          name="chat-composer-message"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 min-h-10 resize-none overflow-hidden !border-0 !rounded-none bg-transparent px-0 py-2 text-base leading-6 !shadow-none outline-none ring-0 ring-offset-0 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />

        <Button
          aria-label="Gravar áudio"
          type="button"
          variant="ghost"
          size="icon"
          className="w-10 h-10 rounded-full glass-surface hover:scale-105 transition-transform"
          onClick={onClickMic}
          disabled={disabled}
        >
          <Mic className="w-5 h-5 text-text-muted" aria-hidden="true" />
        </Button>

        <Button
          aria-label="Enviar mensagem"
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !canSend}
          className="chat-send-button w-10 h-10 rounded-full shadow-glass hover:scale-105 transition-transform"
        >
          <Send className="w-5 h-5 text-white" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
