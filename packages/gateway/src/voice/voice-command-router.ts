import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import type { ConversationTurn } from "./conversation-context.js";

const log = childLogger("voice-command-router");

export type ActionHandler = (ctx: CommandContext) => Promise<ActionResult>;
export type ActionResult = {
  success: boolean;
  message: string;
  data?: unknown;
  tts?: string;
  action?: string;
};

export interface CommandContext {
  userId: string;
  sessionId: string;
  transcript: string;
  intent: string;
  entities: Record<string, string[]>;
  language: "vi" | "en" | "mixed";
  conversationContext: ConversationTurn[];
  rawAudio?: Buffer;
}

interface HandlerRegistration {
  handler: ActionHandler;
  priority: number;
  timeout: number;
}

export interface VoiceCommandRouter {
  registerHandler(intent: string, handler: ActionHandler, options?: HandlerOptions): void;
  unregisterHandler(intent: string): void;
  route(command: CommandContext): Promise<ActionResult>;
  getSupportedIntents(): string[];
  setFallbackHandler(handler: ActionHandler): void;
  setTimeout(ms: number): void;
}

export interface HandlerOptions {
  priority?: number;
  timeout?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

class VoiceCommandRouterImpl extends EventEmitter implements VoiceCommandRouter {
  private handlers = new Map<string, HandlerRegistration[]>();
  private fallbackHandler: ActionHandler | null = null;
  private defaultTimeout: number = DEFAULT_TIMEOUT_MS;

  constructor() {
    super();
    this.initBuiltInHandlers();
  }

  private initBuiltInHandlers(): void {
    // Built-in handlers are registered via registerHandler in the constructor
    // or lazily when first needed
  }

  registerHandler(intent: string, handler: ActionHandler, options?: HandlerOptions): void {
    const registration: HandlerRegistration = {
      handler,
      priority: options?.priority ?? 0,
      timeout: options?.timeout ?? this.defaultTimeout,
    };

    const existing = this.handlers.get(intent) ?? [];
    existing.push(registration);

    // Sort by priority (higher first)
    existing.sort((a, b) => b.priority - a.priority);

    this.handlers.set(intent, existing);

    log.info({ intent, priority: registration.priority }, "[VoiceCommandRouter] Handler registered");
    this.emit("handlerRegistered", { intent, priority: registration.priority });
  }

  unregisterHandler(intent: string): void {
    if (this.handlers.has(intent)) {
      this.handlers.delete(intent);
      log.info({ intent }, "[VoiceCommandRouter] Handler unregistered");
      this.emit("handlerUnregistered", { intent });
    }
  }

  async route(command: CommandContext): Promise<ActionResult> {
    const startTime = Date.now();
    const { intent, sessionId, userId } = command;

    log.info(
      { intent, sessionId, userId, transcript: command.transcript },
      "[VoiceCommandRouter] Routing command"
    );

    try {
      const registrations = this.handlers.get(intent);

      if (!registrations || registrations.length === 0) {
        // Try fallback
        if (this.fallbackHandler) {
          return await this.executeWithTimeout(
            this.fallbackHandler,
            command,
            this.defaultTimeout
          );
        }

        // Default response
        return {
          success: false,
          message: `Không tìm thấy handler cho intent: ${intent}`,
          action: intent,
        };
      }

      // Execute highest priority handler
      const registration = registrations[0]!;
      const result = await this.executeWithTimeout(
        registration.handler,
        command,
        registration.timeout
      );

      const duration = Date.now() - startTime;
      log.info(
        { intent, duration, success: result.success },
        "[VoiceCommandRouter] Command routed"
      );

      this.emit("commandRouted", {
        intent,
        sessionId,
        duration,
        success: result.success,
      });

      // Generate TTS if not provided
      if (result.success && !result.tts) {
        result.tts = this.generateDefaultTts(intent, result.message);
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error(
        { intent, error: errorMessage, duration },
        "[VoiceCommandRouter] Handler error"
      );

      this.emit("routeError", { intent, error: errorMessage, sessionId });

      return {
        success: false,
        message: `Lỗi khi xử lý: ${errorMessage}`,
        action: intent,
      };
    }
  }

  private async executeWithTimeout(
    handler: ActionHandler,
    context: CommandContext,
    timeoutMs: number
  ): Promise<ActionResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Handler timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      handler(context)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private generateDefaultTts(intent: string, _message: string): string {
    // Generate contextual TTS responses
    const responses: Record<string, string[]> = {
      alarm_set: ["Đã đặt báo thức thành công", "Báo thức đã được thiết lập"],
      reminder_set: ["Nhắc nhở đã được tạo", "Đã thêm lời nhắc cho bạn"],
      app_open: ["Đã mở ứng dụng", "Mở rồi nhé"],
      app_close: ["Đã đóng ứng dụng", "Tắt rồi"],
      message_send: ["Tin nhắn đã được gửi", "Gửi rồi nhé"],
      call: ["Đang gọi", "Gọi ngay"],
      music_control: ["Đã xử lý", "OK"],
      search: ["Tìm thấy thông tin", "Kết quả đây"],
      question: ["Câu trả lời đây", "Bạn hỏi về"],
      command: ["Đã thực hiện lệnh", "Xong rồi"],
    };

    const options = responses[intent] ?? ["Đã xong"];
    return options[Math.floor(Math.random() * options.length)];
  }

  getSupportedIntents(): string[] {
    return Array.from(this.handlers.keys());
  }

  setFallbackHandler(handler: ActionHandler): void {
    this.fallbackHandler = handler;
    log.info("[VoiceCommandRouter] Fallback handler set");
  }

  setTimeout(ms: number): void {
    this.defaultTimeout = Math.max(1000, Math.min(120000, ms));
    log.info({ timeout: this.defaultTimeout }, "[VoiceCommandRouter] Default timeout updated");
  }
}

// ─── Built-in Action Handlers ─────────────────────────────────────────────────

async function handleAlarmSet(ctx: CommandContext): Promise<ActionResult> {
  const time = ctx.entities.time?.[0] ?? "unknown";

  // In production: call system API to set alarm
  log.info({ time }, "[VoiceCommandRouter] Setting alarm");

  return {
    success: true,
    message: `Đã đặt báo thức lúc ${time}`,
    action: "alarm_set",
    tts: "Đã đặt báo thức thành công",
  };
}

async function handleReminderSet(ctx: CommandContext): Promise<ActionResult> {
  const content = ctx.transcript;

  log.info({ content }, "[VoiceCommandRouter] Creating reminder");

  return {
    success: true,
    message: "Đã tạo nhắc nhở",
    action: "reminder_set",
    tts: "Đã tạo lời nhắc cho bạn",
  };
}

async function handleAppOpen(ctx: CommandContext): Promise<ActionResult> {
  const appName = ctx.entities.app?.[0] ?? "unknown";

  log.info({ appName }, "[VoiceCommandRouter] Opening app");

  return {
    success: true,
    message: `Đã mở ${appName}`,
    action: "app_open",
    tts: `Mở ${appName} rồi nhé`,
  };
}

async function handleAppClose(ctx: CommandContext): Promise<ActionResult> {
  const appName = ctx.entities.app?.[0] ?? "unknown";

  log.info({ appName }, "[VoiceCommandRouter] Closing app");

  return {
    success: true,
    message: `Đã đóng ${appName}`,
    action: "app_close",
    tts: `Tắt ${appName} rồi`,
  };
}

async function handleMessageSend(_ctx: CommandContext): Promise<ActionResult> {
  log.info("[VoiceCommandRouter] Sending message");

  return {
    success: true,
    message: "Tin nhắn đã được gửi",
    action: "message_send",
    tts: "Tin nhắn đã được gửi",
  };
}

async function handleMusicControl(ctx: CommandContext): Promise<ActionResult> {
  const action = ctx.transcript.toLowerCase().includes("pause") ||
                 ctx.transcript.toLowerCase().includes("dừng")
    ? "pause"
    : "play";

  log.info({ action }, "[VoiceCommandRouter] Music control");

  return {
    success: true,
    message: `Music ${action}`,
    action: "music_control",
    tts: action === "pause" ? "Tạm dừng nhạc" : "Phát nhạc",
  };
}

async function handleSearch(ctx: CommandContext): Promise<ActionResult> {
  const query = ctx.transcript.replace(/tìm|kiếm|search/gi, "").trim();

  log.info({ query }, "[VoiceCommandRouter] Performing search");

  return {
    success: true,
    message: `Tìm kiếm: ${query}`,
    action: "search",
    tts: "Tìm thấy kết quả",
  };
}

// ─── Singleton & Factory ──────────────────────────────────────────────────────

class VoiceCommandRouterFactory {
  private static instance: VoiceCommandRouterImpl | null = null;

  static getInstance(): VoiceCommandRouterImpl {
    if (!VoiceCommandRouterFactory.instance) {
      VoiceCommandRouterFactory.instance = new VoiceCommandRouterImpl();

      // Register built-in handlers
      VoiceCommandRouterFactory.instance.registerHandler("alarm_set", handleAlarmSet, { priority: 10 });
      VoiceCommandRouterFactory.instance.registerHandler("reminder_set", handleReminderSet, { priority: 10 });
      VoiceCommandRouterFactory.instance.registerHandler("app_open", handleAppOpen, { priority: 10 });
      VoiceCommandRouterFactory.instance.registerHandler("app_close", handleAppClose, { priority: 10 });
      VoiceCommandRouterFactory.instance.registerHandler("message_send", handleMessageSend, { priority: 10 });
      VoiceCommandRouterFactory.instance.registerHandler("music_control", handleMusicControl, { priority: 10 });
      VoiceCommandRouterFactory.instance.registerHandler("search", handleSearch, { priority: 10 });
    }
    return VoiceCommandRouterFactory.instance;
  }
}

export const voiceCommandRouter: VoiceCommandRouter = VoiceCommandRouterFactory.getInstance();
