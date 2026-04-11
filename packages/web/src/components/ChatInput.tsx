import { useState, useRef, useCallback } from "react";
import { VoiceButton } from "./VoiceButton";
import { useVoice } from "../hooks/useVoice";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { getCopy } from "../lib/i18n";

interface AttachedFile {
  id: string;
  file: File;
  previewText?: string;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const appLanguage = useChatStore((s) => s.appLanguage);
  const copy = getCopy(appLanguage);
  const isVi = appLanguage === "vi";

  const voice = useVoice({
    sendAudio: (base64) => {
      useChatStore.getState().setVoiceState("transcribing");
      useChatStore.getState().addUserMessage("🎤 Voice command...");
      getClient().sendVoice(base64);
    },
    onTranscript: (_text) => {
      useChatStore.getState().setVoiceState("idle");
    },
    onError: (error) => {
      useChatStore.getState().setVoiceState("idle");
      useChatStore.getState().addSystemMessage(`Voice error: ${error}`);
    },
  });

  const readTextPreview = async (file: File): Promise<string | undefined> => {
    if (!file.type.startsWith("text/") && !file.name.endsWith(".md") && !file.name.endsWith(".json") && !file.name.endsWith(".ts") && !file.name.endsWith(".tsx") && !file.name.endsWith(".js")) {
      return undefined;
    }
    try {
      const content = await file.text();
      return content.slice(0, 3000);
    } catch {
      return undefined;
    }
  };

  const handlePickFiles = async (inputFiles: FileList | null) => {
    if (!inputFiles || inputFiles.length === 0) return;
    const next = await Promise.all(
      Array.from(inputFiles).map(async (file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        previewText: await readTextPreview(file),
      })),
    );
    setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const buildFileContext = () => {
    if (files.length === 0) return "";
    const chunks = files.map((f, idx) => {
      const header = `Attachment ${idx + 1}: ${f.file.name} (${f.file.type || "unknown"}, ${f.file.size} bytes)`;
      if (!f.previewText) return header;
      return `${header}\nPreview:\n${f.previewText}`;
    });
    return `\n\n--- Attached Files Context ---\n${chunks.join("\n\n")}`;
  };

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || disabled) return;
    const body = trimmed || (isVi ? "Phân tích các file đính kèm này." : "Analyze these attached files.");
    onSend(`${body}${buildFileContext()}`);
    setText("");
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    if (fileRef.current) fileRef.current.value = "";
  }, [text, files, disabled, onSend, isVi]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 180) + "px";
    }
  };

  return (
    <div style={{
      borderTop: "1px solid rgba(255,255,255,0.06)",
      background: "rgba(5,5,8,0.8)",
      backdropFilter: "blur(16px)",
      padding: "14px 20px",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "flex-end", gap: 10 }}>
        <VoiceButton
          state={voice.state}
          duration={voice.duration}
          onStart={voice.startRecording}
          onStop={voice.stopRecording}
          onCancel={voice.cancel}
          disabled={disabled}
        />
        <div style={{ flex: 1, position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); handleInput(); }}
            onKeyDown={handleKeyDown}
            placeholder={copy.chat.placeholder}
            rows={1}
            disabled={disabled}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 14,
              padding: "12px 16px",
              color: "var(--color-text-primary)",
              fontSize: "0.875rem",
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
              lineHeight: 1.5,
              transition: "border-color 0.2s, box-shadow 0.2s",
              opacity: disabled ? 0.5 : 1,
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = "rgba(99,102,241,0.45)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.1)";
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => void handlePickFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title={isVi ? "Đính kèm file" : "Attach files"}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            flexShrink: 0,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            color: "var(--color-text-secondary)",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          📎
        </button>

        <button
          onClick={handleSend}
          disabled={disabled || (!text.trim() && files.length === 0)}
          style={{
            width: 44, height: 44,
            borderRadius: 12, flexShrink: 0,
            background: (text.trim() || files.length > 0) && !disabled
              ? "linear-gradient(135deg, #6366f1, #7c3aed)"
              : "rgba(255,255,255,0.06)",
            border: "none",
            color: (text.trim() || files.length > 0) && !disabled ? "white" : "var(--color-text-muted)",
            cursor: disabled || (!text.trim() && files.length === 0) ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
            boxShadow: (text.trim() || files.length > 0) && !disabled ? "0 4px 16px rgba(99,102,241,0.3)" : "none",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      {files.length > 0 && (
        <div style={{ maxWidth: 720, margin: "8px auto 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {files.map((item) => (
            <div
              key={item.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.68rem",
                color: "var(--color-text-secondary)",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 999,
                padding: "4px 8px",
              }}
            >
              <span>{item.file.name}</span>
              <button
                onClick={() => removeFile(item.id)}
                style={{
                  border: "none",
                  background: "none",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                }}
                title={isVi ? "Bỏ file" : "Remove file"}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ maxWidth: 720, margin: "6px auto 0", display: "flex", justifyContent: "flex-end" }}>
        <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>{copy.chat.hint}</span>
      </div>
    </div>
  );
}
