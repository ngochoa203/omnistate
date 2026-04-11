import { useState, useCallback } from "react";
import type { ChatMessage } from "../lib/chat-store";
import { useChatStore } from "../lib/chat-store";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const ttsEnabled = useChatStore((s) => s.ttsEnabled);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = message.content || "";
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        console.error("Clipboard copy failed", err);
      });
  }, [message.content]);

  const handleSpeak = useCallback(() => {
    const text = message.content || "";
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [message.content]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-accent text-white"
            : "bg-bg-tertiary text-text-primary"
        }`}
      >
        {/* User message */}
        {isUser && <p className="whitespace-pre-wrap">{message.content}</p>}

        {/* System message */}
        {!isUser && (
          <>
            {/* Steps */}
            {message.steps && message.steps.length > 0 && (
              <div className="mb-2 text-sm space-y-1">
                {message.steps.map((step) => (
                  <div key={step.step} className="flex items-center gap-2">
                    <span className={
                      step.status === "completed" ? "text-success" :
                      step.status === "failed" ? "text-error" : "text-accent"
                    }>
                      {step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : "▸"}
                    </span>
                    <span className="text-text-secondary">
                      Step {step.step}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      step.layer === "deep" ? "bg-blue-500/20 text-blue-400" :
                      step.layer === "surface" ? "bg-green-500/20 text-green-400" :
                      "bg-purple-500/20 text-purple-400"
                    }`}>
                      {step.layer}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Loading states */}
            {message.status === "pending" && (
              <div className="flex gap-1 py-1">
                <span className="w-2 h-2 rounded-full bg-text-muted animate-pulse-dot" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-text-muted animate-pulse-dot" style={{ animationDelay: "200ms" }} />
                <span className="w-2 h-2 rounded-full bg-text-muted animate-pulse-dot" style={{ animationDelay: "400ms" }} />
              </div>
            )}

            {message.status === "streaming" && !message.content && (
              <div className="flex gap-1 py-1">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" />
              </div>
            )}

            {/* Output content */}
            {message.content && (
              <OutputBlock content={message.content} data={message.data} />
            )}

            {/* Error */}
            {message.status === "failed" && !message.content && (
              <p className="text-error text-sm">✗ Task failed</p>
            )}

            {/* Actions bar */}
            {message.content && message.status !== "pending" && (
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-white/5">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text-secondary hover:bg-white/5 transition-colors"
                  title="Copy"
                >
                  {copied ? (
                    <svg className="w-3.5 h-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={handleSpeak}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-text-secondary hover:bg-white/5 transition-colors"
                  title="Read aloud"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
                  Speak
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Output Formatting ──────────────────────────────────────────────────────

function OutputBlock({ content, data }: { content: string; data?: Record<string, unknown> }) {
  // Try to detect and format JSON
  if (data && Object.keys(data).length > 0) {
    return <FormattedData data={data} fallback={content} />;
  }

  // Check if content looks like JSON
  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);
      return <FormattedData data={parsed} fallback={content} />;
    } catch {
      // Not valid JSON, fall through
    }
  }

  // Check if it looks like command output (has paths, flags, etc.)
  const looksLikeCode = /^(\s*[\/$~>]|.*\s{2,}\S|COMMAND\s+PID|USER\s+PID|Filesystem\s+)/m.test(trimmed);
  if (looksLikeCode) {
    return (
      <pre className="whitespace-pre-wrap text-sm font-mono overflow-x-auto bg-black/20 rounded-lg p-3 -mx-1">
        {content}
      </pre>
    );
  }

  // Plain text
  return <p className="whitespace-pre-wrap text-sm">{content}</p>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FormattedData({ data, fallback }: { data: any; fallback: string }) {
  // If data has an "output" field that's a string, prefer showing that
  if (data?.output && typeof data.output === "string") {
    return (
      <pre className="whitespace-pre-wrap text-sm font-mono overflow-x-auto bg-black/20 rounded-lg p-3 -mx-1">
        {data.output}
      </pre>
    );
  }

  // Render as key-value pairs if it's a flat object
  if (typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data).filter(([, v]) => v != null);
    if (entries.length <= 12 && entries.every(([, v]) => typeof v !== "object")) {
      return (
        <div className="space-y-1 text-sm">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-text-muted min-w-25">{formatKey(key)}</span>
              <span className="text-text-primary font-mono">{String(value)}</span>
            </div>
          ))}
        </div>
      );
    }
  }

  // Render as array table if it's an array of objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
    const keys = Object.keys(data[0]).slice(0, 5);
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="text-sm w-full">
          <thead>
            <tr className="border-b border-white/10">
              {keys.map(k => <th key={k} className="text-left text-text-muted px-2 py-1 font-medium">{formatKey(k)}</th>)}
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {data.slice(0, 10).map((row: any, i: number) => (
              <tr key={i} className="border-b border-white/5">
                {keys.map(k => <td key={k} className="px-2 py-1 font-mono text-xs">{String(row[k] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 10 && <p className="text-text-muted text-xs mt-1">... and {data.length - 10} more</p>}
      </div>
    );
  }

  // Fallback: formatted JSON
  void fallback;
  return (
    <pre className="whitespace-pre-wrap text-sm font-mono overflow-x-auto bg-black/20 rounded-lg p-3 -mx-1">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^\w/, c => c.toUpperCase()).trim();
}
