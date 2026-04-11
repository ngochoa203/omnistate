import { useState, useRef, useCallback } from "react";
import { VoiceButton } from "./VoiceButton";
import { useVoice } from "../hooks/useVoice";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [text, disabled, onSend]);

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
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  };

  return (
    <div className="border-t border-border bg-bg-secondary p-4">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <VoiceButton
          state={voice.state}
          duration={voice.duration}
          onStart={voice.startRecording}
          onStop={voice.stopRecording}
          onCancel={voice.cancel}
          disabled={disabled}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); handleInput(); }}
          onKeyDown={handleKeyDown}
          placeholder="Control your Mac with natural language..."
          rows={1}
          disabled={disabled}
          className="flex-1 bg-bg-tertiary text-text-primary rounded-xl px-4 py-3 resize-none outline-none focus:ring-2 focus:ring-accent placeholder:text-text-muted disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="bg-accent hover:bg-accent-hover text-white px-4 py-3 rounded-xl font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}
