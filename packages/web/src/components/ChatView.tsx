import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../lib/chat-store";
import { getClient } from "../hooks/useGateway";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const connectionState = useChatStore((s) => s.connectionState);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback((text: string) => {
    useChatStore.getState().addUserMessage(text);
    getClient().sendTask(text);
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted px-4">
          <p className="text-6xl mb-4">🧠</p>
          <p className="text-xl font-medium mb-2 text-text-primary">OmniState</p>
          <p className="mb-6">Control your MacBook with natural language</p>
          <div className="grid grid-cols-2 gap-3 max-w-md w-full">
            {["list all files", "check disk space", "show top 5 processes", "what is my hostname"].map((cmd) => (
              <button
                key={cmd}
                onClick={() => handleSend(cmd)}
                disabled={connectionState !== "connected"}
                className="text-left px-3 py-2.5 bg-bg-tertiary hover:bg-bg-hover rounded-lg text-sm text-text-secondary transition-colors disabled:opacity-30"
              >
                "{cmd}"
              </button>
            ))}
          </div>
        </div>
        <ChatInput onSend={handleSend} disabled={connectionState !== "connected"} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      <ChatInput onSend={handleSend} disabled={connectionState !== "connected"} />
    </div>
  );
}
