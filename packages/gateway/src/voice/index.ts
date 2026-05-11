// Voice module barrel exports
// All voice-related modules for the OmniState voice pipeline

// Core orchestration
export { VoiceOrchestrator, VoiceState } from "./voice-orchestrator.js";
export type { VoiceStateChangeCallback, VoiceOrchestratorOptions } from "./voice-orchestrator.js";

// Wake word detection
export { WakeManager } from "./wake-manager.js";
export type { WakeConfig, WakeManagerOptions, HealthStatus } from "./wake-manager.js";

// Speaker verification & enrollment
export { verifySpeaker, extractEmbedding, cosineSimilarity } from "./verification.js";
export type { VerificationResult } from "./verification.js";

export {
  handleEnrollStart,
  handleEnrollSample,
  handleEnrollFinalize,
  handleEnrollCancel,
  cleanupEnrollSession,
  analyzeAudioQuality,
  analyzePronunciation,
} from "./enrollment.js";

export { saveProfile, loadProfile, deleteProfile } from "./profile-store.js";
export type { VoiceProfile } from "./profile-store.js";

// Speech-to-text
export { whisperLocalClient } from "./whisper-local-client.js";
export type { TranscriptEvent, HealthCheckResult, AudioQuality } from "./whisper-local-client.js";

// Voice Activity Detection
export { AudioIngest } from "./audio-ingest.js";
export type { SpeechStartEvent, SpeechFrameEvent, SpeechEndEvent, AudioIngestConfig } from "./audio-ingest.js";

// Text-to-speech
export { StreamingTTS } from "./tts-stream.js";
export type { TtsChunk } from "./tts-stream.js";

export { synthesize as edgeTtsSynthesize, pickVoice } from "./edge-tts.js";

// Liveness & anti-spoofing
export { analyzeLiveness } from "./liveness-detection.js";
export type { LivenessResult, Check, LivenessMetadata } from "./liveness-detection.js";

// Voice streaming
export { VoiceStreamManager } from "./webrtc-stream.js";
export type {
  VoiceStreamStartMessage,
  VoiceStreamStopMessage,
  VoiceStreamServerMessage,
  VoiceStreamErrorMessage,
} from "./webrtc-stream.js";

// ─── NEW: Advanced Voice Features ────────────────────────────────────────────

// Conversation context (multi-turn)
export { conversationContext, ConversationState } from "./conversation-context.js";
export type { ConversationContext, ConversationTurn, TrackedEntity } from "./conversation-context.js";

// Intent parsing (streaming)
export { intentParser } from "./intent-parser.js";
export type { IntentParser, IntentLabel, IntentCandidate } from "./intent-parser.js";

// Vietnamese NLP
export {
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
} from "./vietnamese-nlp.js";
export type { IntentExtractionResult, TimeEntity, NumberEntity, CodeSwitchSegment } from "./vietnamese-nlp.js";

// Interrupt handling (barge-in v2)
export { interruptHandler } from "./interrupt-handler.js";
export type {
  InterruptContext,
  InterruptHandler,
  InterruptPriority,
  InterruptType,
  ResponseCancellation,
  MonitorOptions,
} from "./interrupt-handler.js";

// Noise profiling & calibration
export { noiseProfiler } from "./noise-profiler.js";
export type { NoiseProfile, NoiseProfiler, NoiseProfilerOptions } from "./noise-profiler.js";

// Speaker adaptation (online learning)
export { speakerAdaptation } from "./speaker-adaptation.js";
export type { SpeakerAdaptation, AdaptationConfig, AdaptationMetrics } from "./speaker-adaptation.js";

// Emotion detection
export { emotionDetector } from "./emotion-detector.js";
export type { EmotionDetector, EmotionState, EmotionResult, EmotionFeatures } from "./emotion-detector.js";

// Device profiles & optimization
export { deviceOptimizer } from "./device-profiles.js";
export type {
  DeviceOptimizer,
  DeviceProfile,
  DeviceType,
  DeviceCapabilities,
  AudioProfile,
  RecommendedSettings,
} from "./device-profiles.js";

// Voice configuration
export {
  getVoiceConfig,
  updateVoiceConfig,
  resetVoiceConfig,
  loadFromEnv,
} from "./voice-config.js";
export type { VoiceConfig, WakeConfig as VoiceWakeConfig, VadConfig as VoiceVadConfig } from "./voice-config.js";

// Voice metrics
export {
  recordMetric,
  getMetrics,
  getHealthStatus,
  wrapVerification,
  wrapStt,
  wrapTts,
  wrapWakeDetection,
  recordEnrollmentQuality,
  recordEnrollmentResult,
  recordEndToEndLatency,
  startPeriodicSummary,
  stopPeriodicSummary,
} from "./voice-metrics.js";
export type { MetricSummary, HealthStatus as MetricsHealthStatus } from "./voice-metrics.js";

// ─── Wave 2: Streaming & Command Features ──────────────────────────────────────

// Streaming wake word listener
export { createStreamingWakeListener, streamingWakeListener } from "./streaming-wake.js";
export type {
  StreamingWakeListener,
  SessionState as WakeSessionState,
  StreamingWakeConfig,
} from "./streaming-wake.js";

// Voice command router
export type { ActionHandler, ActionResult, CommandContext, HandlerOptions } from "./voice-command-router.js";
export { voiceCommandRouter } from "./voice-command-router.js";

// Voice command registry (fuzzy matching)
export type { VoiceCommand } from "./voice-command-registry.js";
export { voiceCommandRegistry } from "./voice-command-registry.js";

// Multilingual support (VI/EN/ZH/JA)
export {
  detectLanguage,
  getSttLanguage,
  getTtsVoice,
  autoDetectLanguage,
  normalizeForLanguage,
  getGreeting,
  getLanguageName,
  supportsFeature,
} from "./multilingual.js";
export type { LanguageDetectionResult, Language } from "./multilingual.js";

// Streaming quality adaptation
export type { QualitySettings, NetworkMetrics, QualityMode, NetworkCondition, StreamingQualityConfig } from "./streaming-quality.js";
export { streamingQuality } from "./streaming-quality.js";

// Voice analytics
export type { SessionMetrics, IntentStats, LatencyStats, AnalyticsExport } from "./voice-analytics.js";
export { voiceAnalytics } from "./voice-analytics.js";

// ─── Wave 3: Pipeline Extensions ───────────────────────────────────────────────

// Pipeline hooks for extensibility
export type { PipelineHook, PipelineContext } from "./voice-pipeline-hooks.js";
export type { PipelineStage } from "./voice-pipeline-hooks.js";
export {
  voicePipelineHooks,
  createLoggingHook,
  createMetricsHook,
  createValidationHook,
} from "./voice-pipeline-hooks.js";

// Voice result caching
export type { CacheKey, CacheStats } from "./voice-cache.js";
export type { CacheEntry } from "./voice-cache.js";
export {
  voiceCache,
  sttCache,
  intentCache,
  entityCache,
} from "./voice-cache.js";

// Voice session persistence
export type { SessionState, SavedTurn } from "./voice-session-persistence.js";
export {
  voiceSessionPersistence,
  resumeSession,
  createSessionState,
  serializeTurn,
} from "./voice-session-persistence.js";

// Real-time pitch detection
export type { PitchResult, PitchTrack, PitchStatistics, PitchUnit } from "./pitch-detection.js";
export {
  pitchDetection,
  hzToSemitones,
  hzToNoteName,
  estimateGender,
} from "./pitch-detection.js";

// ─── Wave 4: Advanced Features ────────────────────────────────────────────────

// Voice skill loader (plugin system)
export type { VoiceSkill, SkillManifest, SkillHandlers, SkillContext, SkillResult, SkillStatus, SkillSummary } from "./voice-skill-loader.js";
export { voiceSkillLoader } from "./voice-skill-loader.js";

// Ambient sound classifier
export type { AmbientSound, AmbientEvent, AmbientSummary } from "./ambient-classifier.js";
export { ambientClassifier } from "./ambient-classifier.js";

// Cross-device handoff
export type { DeviceInfo, HandoffState, HandoffStatus } from "./voice-handoff.js";
export type { DeviceCapabilities as HandoffDeviceCapabilities } from "./voice-handoff.js";
export { voiceHandoff } from "./voice-handoff.js";

// Voice privacy controls
export type { PrivacyLevel, PrivacySetting, AuditEntry } from "./voice-privacy.js";
export { voicePrivacy } from "./voice-privacy.js";

// Voice macro recorder
export type { VoiceMacro, MacroStep, RecordingState } from "./voice-macro-recorder.js";
export { voiceMacroRecorder } from "./voice-macro-recorder.js";
