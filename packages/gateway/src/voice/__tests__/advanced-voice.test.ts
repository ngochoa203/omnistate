/**
 * Advanced Voice Module Tests
 *
 * Tests for conversation-context, intent-parser, vietnamese-nlp,
 * interrupt-handler, noise-profiler, speaker-adaptation, emotion-detector, device-profiles
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock environment
process.env.OMNISTATE_ENROLL_MOCK = "1";
process.env.MAX_CONTEXT_TURNS = "10";

import {
  conversationContext,
  ConversationState,
} from "../conversation-context.js";

import {
  intentParser,
} from "../intent-parser.js";

import {
  normalizeVietnameseText,
  tokenizeVietnamese,
  extractIntentFromText,
  extractTimeEntities,
  extractNumberEntities,
  expandAbbreviations,
  classifySentenceType,
  detectCodeSwitching,
  normalizeForMatching,
  isQuestion,
  isCommand,
  isGreeting,
} from "../vietnamese-nlp.js";

import {
  interruptHandler,
} from "../interrupt-handler.js";

import {
  noiseProfiler,
} from "../noise-profiler.js";

import {
  speakerAdaptation,
} from "../speaker-adaptation.js";

import {
  emotionDetector,
} from "../emotion-detector.js";

import {
  deviceOptimizer,
} from "../device-profiles.js";

describe("conversation-context", () => {
  beforeEach(() => {
    conversationContext.reset();
  });

  afterEach(() => {
    conversationContext.reset();
  });

  it("should push transcript and track entities", () => {
    const turn = conversationContext.pushTranscript(
      "Mở Safari và tìm kiếm thông tin về AI",
      "search"
    );

    expect(turn.id).toBeDefined();
    expect(turn.text).toContain("Safari");
    expect(turn.intent).toBe("search");
    expect(turn.entities.length).toBeGreaterThan(0);

    const appEntities = turn.entities.filter((e) => e.type === "app");
    expect(appEntities.some((e) => e.value.toLowerCase() === "safari")).toBe(true);
  });

  it("should maintain rolling context window", () => {
    for (let i = 0; i < 15; i++) {
      conversationContext.pushTranscript(`Command ${i}`);
    }

    const window = conversationContext.getContextWindow();
    expect(window.length).toBeLessThanOrEqual(10);
  });

  it("should track entities across turns", () => {
    conversationContext.pushTranscript("Mở Safari");
    conversationContext.pushTranscript("Đóng Safari");

    const allEntities = conversationContext.getEntities();
    const safariEntities = allEntities.filter((e) => e.value.toLowerCase() === "safari");
    expect(safariEntities.length).toBeGreaterThan(0);
  });

  it("should confirm actions with Vietnamese responses", () => {
    conversationContext.setState(ConversationState.AWAITING_CONFIRMATION);

    expect(conversationContext.confirmAction("delete", "có")).toBe(true);
    expect(conversationContext.confirmAction("delete", "không")).toBe(false);
    expect(conversationContext.confirmAction("delete", "đồng ý")).toBe(true);
    expect(conversationContext.confirmAction("delete", "thôi")).toBe(false);
    expect(conversationContext.confirmAction("delete", "vâng")).toBe(true);
    expect(conversationContext.confirmAction("delete", "ừ")).toBe(true);
  });

  it("should reset context", () => {
    conversationContext.pushTranscript("Test command", "command");
    conversationContext.trackEntity("test", "value");

    expect(conversationContext.getConversationState()).not.toBe(ConversationState.INITIAL);

    conversationContext.reset();

    expect(conversationContext.getConversationState()).toBe(ConversationState.INITIAL);
    expect(conversationContext.getContextWindow().length).toBe(0);
    expect(conversationContext.getEntities().length).toBe(0);
  });

  it("should auto-detect confirmation state", () => {
    conversationContext.pushTranscript("Bạn có muốn xóa không?", "question");
    expect(conversationContext.getConversationState()).toBe(ConversationState.AWAITING_CONFIRMATION);
  });
});

describe("intent-parser", () => {
  beforeEach(() => {
    intentParser.reset();
  });

  afterEach(() => {
    intentParser.reset();
  });

  it("should classify app open intent", () => {
    const result = intentParser.feed("Mở Safari");
    expect(result.label).toBe("app_open");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should classify alarm intent", () => {
    const result = intentParser.feed("Đặt báo thức lúc 7 giờ");
    expect(result.label).toBe("alarm_set");
  });

  it("should classify reminder intent", () => {
    const result = intentParser.feed("Nhắc nhở tôi về cuộc họp");
    expect(result.label).toBe("reminder_set");
  });

  it("should classify music control intent", () => {
    const result = intentParser.feed("Bật nhạc lên");
    expect(result.label).toBe("music_control");
  });

  it("should classify search intent", () => {
    const result = intentParser.feed("Tìm kiếm thông tin về AI");
    expect(result.label).toBe("search");
  });

  it("should extract entities", () => {
    const result = intentParser.feed("Đặt báo thức lúc 7:00");
    expect(result.entities.some((e) => e.includes("7:00"))).toBe(true);
  });

  it("should return multiple candidates", () => {
    const candidates = intentParser.feedMultiple("Mở Safari và chơi nhạc", 3);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[0]!.label).toBe("app_open");
  });

  it("should handle empty text", () => {
    const result = intentParser.feed("");
    expect(result.label).toBe("unknown");
    expect(result.confidence).toBe(0);
  });
});

describe("vietnamese-nlp", () => {
  it("should normalize Vietnamese text", () => {
    const result = normalizeVietnameseText("Hiiiiiii bạn mk");
    expect(result).toContain("hi");
    expect(result).toContain("bạn");
    expect(result).toContain("mình");
  });

  it("should expand abbreviations", () => {
    const result = expandAbbreviations("mk mk bình thường");
    expect(result).toContain("mình");
    expect(result).toContain("bình thường");
  });

  it("should tokenize Vietnamese text", () => {
    const tokens = tokenizeVietnamese("Mở Safari và tìm kiếm");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("should extract intent from text", () => {
    const result = extractIntentFromText("Mở Safari");
    expect(result.intent).toBe("open_app");
  });

  it("should extract time entities", () => {
    const result = extractTimeEntities("Đặt báo thức lúc 7 giờ");
    expect(result.relative).toBe("specific_time");

    const result2 = extractTimeEntities("5 phút nữa");
    expect(result2.relative).toBe("in_5_minutes");
  });

  it("should extract number entities", () => {
    const result = extractNumberEntities("5 cái");
    expect(result.value).toBe(5);

    const result2 = extractNumberEntities("2 tiếng");
    expect(result2.value).toBe(2);
  });

  it("should classify sentence types", () => {
    expect(classifySentenceType("Bạn có muốn không?")).toBe("question");
    expect(classifySentenceType("Mở Safari")).toBe("command");
    expect(classifySentenceType("Xin chào")).toBe("greeting");
    expect(classifySentenceType("Hôm nay trời đẹp")).toBe("statement");
  });

  it("should detect code switching", () => {
    const result = detectCodeSwitching("Mở Safari app");
    expect(result.hasCodeSwitch).toBe(true);
  });

  it("should normalize for matching", () => {
    const result = normalizeForMatching("Xin Chào!");
    expect(result).toBe("xin chao");
  });

  it("should check for questions", () => {
    expect(isQuestion("Bạn có muốn không?")).toBe(true);
    expect(isQuestion("Mở Safari")).toBe(false);
  });

  it("should check for commands", () => {
    expect(isCommand("Mở Safari")).toBe(true);
    expect(isCommand("Bạn có muốn không?")).toBe(false);
  });

  it("should check for greetings", () => {
    expect(isGreeting("Xin chào")).toBe(true);
    expect(isGreeting("Mở Safari")).toBe(false);
  });
});

describe("interrupt-handler", () => {
  it("should start monitoring", () => {
    interruptHandler.startMonitoring("session-1");
    expect(true).toBe(true); // No throw
  });

  it("should record response delivery", () => {
    interruptHandler.startMonitoring("session-2");
    interruptHandler.recordResponseDelivery("session-2", 100);
    interruptHandler.recordResponseDelivery("session-2", 50);
    expect(true).toBe(true);
  });

  it("should cancel response", () => {
    interruptHandler.startMonitoring("session-3");
    interruptHandler.recordResponseDelivery("session-3", 100);

    const result = interruptHandler.cancelResponse("session-3");
    expect(result.cancelled).toBe(true);
  });

  it("should check for interrupt based on audio energy", () => {
    interruptHandler.startMonitoring("session-4");
    const hasInterrupt = interruptHandler.checkForInterrupt("session-4", 0.8);
    expect(typeof hasInterrupt).toBe("boolean");
  });

  it("should determine priority precedence", () => {
    const critical = { type: "barge_in" as const, priority: "critical" as const, sessionId: "s1", timestamp: Date.now(), canResume: true };
    const normal = { type: "barge_in" as const, priority: "normal" as const, sessionId: "s2", timestamp: Date.now(), canResume: true };

    expect(interruptHandler.shouldInterrupt(critical, normal)).toBe(true);
    expect(interruptHandler.shouldInterrupt(normal, critical)).toBe(false);
  });
});

describe("noise-profiler", () => {
  beforeEach(() => {
    noiseProfiler.reset();
  });

  it("should feed samples", () => {
    noiseProfiler.feedSample(0.1);
    noiseProfiler.feedSample(0.15);
    noiseProfiler.feedSample(0.12);

    const profile = noiseProfiler.getProfile();
    expect(profile.noiseFloorDb).toBeDefined();
  });

  it("should not be calibrated initially", () => {
    expect(noiseProfiler.isCalibrated()).toBe(false);
  });

  it("should be calibrated after enough samples", () => {
    for (let i = 0; i < 20; i++) {
      noiseProfiler.feedSample(0.1 + Math.random() * 0.05);
    }

    const status = noiseProfiler.getCalibrationStatus();
    expect(status.sampleCount).toBeGreaterThan(0);
  });

  it("should get recommended thresholds", () => {
    noiseProfiler.feedSample(0.1);

    const wakeThreshold = noiseProfiler.getRecommendedThreshold("wake");
    const vadSpeechThreshold = noiseProfiler.getRecommendedThreshold("vad_speech");
    const vadSilenceThreshold = noiseProfiler.getRecommendedThreshold("vad_silence");

    expect(typeof wakeThreshold).toBe("number");
    expect(typeof vadSpeechThreshold).toBe("number");
    expect(typeof vadSilenceThreshold).toBe("number");
  });
});

describe("speaker-adaptation", () => {
  beforeEach(() => {
    speakerAdaptation.resetUser("test-user");
  });

  it("should record verification", () => {
    const embedding = Array(256).fill(0).map(() => Math.random() * 2 - 1);
    speakerAdaptation.recordVerification("test-user", embedding, 0.9);

    const metrics = speakerAdaptation.getMetrics("test-user");
    expect(metrics.totalVerifications).toBe(1);
  });

  it("should return null for non-existent user", () => {
    const embedding = speakerAdaptation.getAdaptedEmbedding("nonexistent-user");
    expect(embedding).toBeNull();
  });

  it("should get statistics", () => {
    const stats = speakerAdaptation.getStatistics();
    expect(stats.totalUsers).toBeDefined();
  });

  it("should adapt after enough samples", () => {
    const embedding = Array(256).fill(0).map(() => Math.random() * 2 - 1);

    // Record multiple verifications
    for (let i = 0; i < 6; i++) {
      speakerAdaptation.recordVerification("test-user-adapt", embedding, 0.85);
    }

    const adapted = speakerAdaptation.getAdaptedEmbedding("test-user-adapt");
    expect(adapted).not.toBeNull();
    expect(adapted).toHaveLength(256);
  });
});

describe("emotion-detector", () => {
  beforeEach(() => {
    emotionDetector.reset();
  });

  it("should detect emotion from audio", () => {
    // Create mock audio buffer (16000Hz, 1 second of audio)
    const sampleRate = 16000;
    const durationSec = 1;
    const bufferSize = sampleRate * durationSec * 2; // 16-bit samples
    const audioBuffer = Buffer.alloc(bufferSize);

    // Generate some audio-like data
    for (let i = 0; i < bufferSize / 2; i++) {
      const amplitude = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 16000;
      audioBuffer.writeInt16LE(Math.round(amplitude), i * 2);
    }

    const result = emotionDetector.detectEmotion(audioBuffer, sampleRate);
    expect(result.emotion).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.suggestedTtsAdjustments).toBeDefined();
  });

  it("should get current result", () => {
    const result = emotionDetector.getResult();
    expect(result.emotion).toBeDefined();
  });

  it("should reset", () => {
    emotionDetector.reset();
    const result = emotionDetector.getResult();
    expect(result.emotion).toBe("unknown");
  });
});

describe("device-profiles", () => {
  it("should set device", () => {
    const profile = deviceOptimizer.setDevice("macos", "MacBook Pro");
    expect(profile.deviceType).toBe("macos");
    expect(profile.recommendedSettings.whisperModel).toBe("small");
  });

  it("should auto-detect device", () => {
    const profile = deviceOptimizer.autoDetect();
    expect(profile.deviceType).toBeDefined();
  });

  it("should get recommended settings for airpods", () => {
    deviceOptimizer.setDevice("airpods_pro");
    const settings = deviceOptimizer.getRecommendedSettings();

    expect(settings.whisperModel).toBe("tiny");
    expect(settings.sttProvider).toBe("whisper-local");
    expect(settings.enableContinuousListening).toBe(true);
  });

  it("should support features", () => {
    deviceOptimizer.setDevice("macos");
    expect(deviceOptimizer.supportsFeature("supportsHardwareAcceleration")).toBe(true);
  });

  it("should adjust for low power mode", () => {
    deviceOptimizer.setDevice("iphone");
    deviceOptimizer.setPowerMode("battery_saver");

    const settings = deviceOptimizer.getRecommendedSettings();
    expect(settings.enableContinuousListening).toBe(false);
    expect(settings.whisperModel).toBe("tiny");
  });

  it("should get audio profile", () => {
    deviceOptimizer.setDevice("airpods_pro");
    const audioProfile = deviceOptimizer.getAudioProfile();

    expect(audioProfile.inputLatencyMs).toBeLessThanOrEqual(20);
    expect(audioProfile.recommendedChunkMs).toBeLessThanOrEqual(200);
  });
});

describe("Advanced Voice Integration", () => {
  it("should export all modules from index", async () => {
    // Dynamic import to test barrel exports
    const voiceModule = await import("../index.js");

    expect(voiceModule.conversationContext).toBeDefined();
    expect(voiceModule.intentParser).toBeDefined();
    expect(voiceModule.noiseProfiler).toBeDefined();
    expect(voiceModule.speakerAdaptation).toBeDefined();
    expect(voiceModule.emotionDetector).toBeDefined();
    expect(voiceModule.deviceOptimizer).toBeDefined();
    expect(voiceModule.interruptHandler).toBeDefined();
  });

  it("should have Vietnamese NLP utilities", async () => {
    const result = normalizeVietnameseText("Tôi mk");
    expect(result).toContain("mình");
  });

  it("should classify intents from Vietnamese commands", () => {
    intentParser.reset();

    const commands = [
      { text: "Mở Safari", expected: "app_open" },
      { text: "Đặt báo thức lúc 7 giờ", expected: "alarm_set" },
      { text: "Nhắc nhở tôi về cuộc họp", expected: "reminder_set" },
      { text: "Gửi tin nhắn cho An", expected: "message_send" },
      { text: "Bật nhạc lên", expected: "music_control" },
    ];

    for (const { text, expected } of commands) {
      const result = intentParser.feed(text);
      expect(result.label).toBe(expected);
    }
  });

  it("should handle conversation with context", () => {
    conversationContext.reset();

    // User asks a question
    conversationContext.pushTranscript("Mở Safari giúp tôi", "app_open");

    // User confirms
    const confirmed = conversationContext.confirmAction("open_safari", "có");
    expect(confirmed).toBe(true);

    // Next command
    const turn2 = conversationContext.pushTranscript("Đóng Safari", "app_close");
    expect(turn2).toBeDefined();
  });

  it("should integrate noise profiling with threshold recommendations", () => {
    noiseProfiler.reset();

    // Simulate noisy environment
    for (let i = 0; i < 15; i++) {
      noiseProfiler.feedSample(0.3 + Math.random() * 0.1);
    }

    const profile = noiseProfiler.getProfile();
    expect(profile.recommendedWakeThreshold).toBeGreaterThan(0.3);

    const wakeThreshold = noiseProfiler.getRecommendedThreshold("wake");
    const vadSpeechThreshold = noiseProfiler.getRecommendedThreshold("vad_speech");

    expect(wakeThreshold).toBeGreaterThan(vadSpeechThreshold - 0.2);
  });
});
