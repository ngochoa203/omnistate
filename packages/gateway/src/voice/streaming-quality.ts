import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";

const log = childLogger("streaming-quality");

export type QualityMode = "high" | "balanced" | "low" | "adaptive";
export type NetworkCondition = "excellent" | "good" | "fair" | "poor" | "unknown";

export interface StreamingQualityConfig {
  initialMode: QualityMode;
  enableAdaptive: boolean;
  checkIntervalMs: number;
}

export interface QualitySettings {
  mode: QualityMode;
  chunkSizeMs: number;
  encodingQuality: number;      // 0-1, higher = better quality
  sampleRate: number;
  channels: number;
  enableCompression: boolean;
  maxLatencyMs: number;
  targetLatencyMs: number;
}

export interface NetworkMetrics {
  condition: NetworkCondition;
  latencyMs: number;
  jitterMs: number;
  packetLossPercent: number;
  bandwidthKbps: number;
  qualityScore: number;        // 0-1 composite score
  lastUpdated: number;
}

export interface StreamingQuality {
  getCurrentSettings(): QualitySettings;
  getNetworkMetrics(): NetworkMetrics;
  getQualityMode(): QualityMode;
  setQualityMode(mode: QualityMode): void;
  updateNetworkMetrics(metrics: Partial<NetworkMetrics>): void;
  requestQualityIncrease(): void;
  requestQualityDecrease(): void;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
}

const DEFAULT_CONFIG: Required<StreamingQualityConfig> = {
  initialMode: "balanced",
  enableAdaptive: true,
  checkIntervalMs: 5000,
};

const QUALITY_PRESETS: Record<QualityMode, QualitySettings> = {
  high: {
    mode: "high",
    chunkSizeMs: 220,
    encodingQuality: 0.9,
    sampleRate: 48000,
    channels: 1,
    enableCompression: false,
    maxLatencyMs: 500,
    targetLatencyMs: 200,
  },
  balanced: {
    mode: "balanced",
    chunkSizeMs: 160,
    encodingQuality: 0.7,
    sampleRate: 16000,
    channels: 1,
    enableCompression: true,
    maxLatencyMs: 300,
    targetLatencyMs: 150,
  },
  low: {
    mode: "low",
    chunkSizeMs: 80,
    encodingQuality: 0.5,
    sampleRate: 8000,
    channels: 1,
    enableCompression: true,
    maxLatencyMs: 150,
    targetLatencyMs: 80,
  },
  adaptive: {
    mode: "adaptive",
    chunkSizeMs: 160,
    encodingQuality: 0.7,
    sampleRate: 16000,
    channels: 1,
    enableCompression: true,
    maxLatencyMs: 300,
    targetLatencyMs: 150,
  },
};

class StreamingQualityImpl extends EventEmitter implements StreamingQuality {
  private config: Required<StreamingQualityConfig>;
  private currentMode: QualityMode;
  private enabled = true;
  private networkMetrics: NetworkMetrics = {
    condition: "unknown",
    latencyMs: 0,
    jitterMs: 0,
    packetLossPercent: 0,
    bandwidthKbps: 0,
    qualityScore: 1.0,
    lastUpdated: Date.now(),
  };
  private qualityRequests = { increase: 0, decrease: 0 };
  private adaptationHistory: Array<{ timestamp: number; qualityScore: number }> = [];

  constructor(config?: Partial<StreamingQualityConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentMode = this.config.initialMode;
  }

  private getPreset(mode: QualityMode): QualitySettings {
    return { ...QUALITY_PRESETS[mode] };
  }

  private evaluateNetworkCondition(metrics: Partial<NetworkMetrics>): NetworkCondition {
    const latency = metrics.latencyMs ?? this.networkMetrics.latencyMs;
    const jitter = metrics.jitterMs ?? this.networkMetrics.jitterMs;
    const packetLoss = metrics.packetLossPercent ?? this.networkMetrics.packetLossPercent;
    const bandwidth = metrics.bandwidthKbps ?? this.networkMetrics.bandwidthKbps;

    if (latency < 50 && jitter < 10 && packetLoss < 0.5 && bandwidth > 500) {
      return "excellent";
    }
    if (latency < 100 && jitter < 20 && packetLoss < 1 && bandwidth > 200) {
      return "good";
    }
    if (latency < 200 && jitter < 50 && packetLoss < 3 && bandwidth > 100) {
      return "fair";
    }
    if (latency > 500 || packetLoss > 5 || bandwidth < 50) {
      return "poor";
    }
    return "unknown";
  }

  private calculateQualityScore(): number {
    const { latencyMs, jitterMs, packetLossPercent, bandwidthKbps } = this.networkMetrics;

    // Weight factors
    const latencyScore = Math.max(0, 1 - latencyMs / 500);
    const jitterScore = Math.max(0, 1 - jitterMs / 100);
    const lossScore = Math.max(0, 1 - packetLossPercent / 10);
    const bandwidthScore = Math.min(1, bandwidthKbps / 500);

    // Composite score (weighted average)
    const score = (
      latencyScore * 0.35 +
      jitterScore * 0.20 +
      lossScore * 0.25 +
      bandwidthScore * 0.20
    );

    return Math.round(score * 100) / 100;
  }

  private autoAdapt(): void {
    if (this.currentMode !== "adaptive" || !this.config.enableAdaptive) {
      return;
    }

    const score = this.networkMetrics.qualityScore;
    const currentPreset = this.getPreset(this.currentMode);

    // History for trend analysis
    this.adaptationHistory.push({ timestamp: Date.now(), qualityScore: score });
    if (this.adaptationHistory.length > 20) {
      this.adaptationHistory.shift();
    }

    // Determine new mode based on quality
    if (score >= 0.8) {
      // Excellent - can increase quality
      if (currentPreset.mode !== "high") {
        this.applyMode("high");
        log.info({ mode: "high", reason: "quality_score_excellent" }, "[StreamingQuality] Mode upgraded");
      }
    } else if (score >= 0.6) {
      // Good - maintain balanced
      if (currentPreset.mode !== "balanced") {
        this.applyMode("balanced");
        log.info({ mode: "balanced", reason: "quality_score_good" }, "[StreamingQuality] Mode balanced");
      }
    } else if (score >= 0.4) {
      // Fair - decrease quality
      if (currentPreset.mode !== "low") {
        this.applyMode("low");
        log.info({ mode: "low", reason: "quality_score_fair" }, "[StreamingQuality] Mode downgraded");
      }
    } else {
      // Poor - minimal quality
      this.applyMode("low");
      log.warn("[StreamingQuality] Network quality poor, minimal quality mode");
    }

    this.emit("qualityAdapted", { mode: this.currentMode, score });
  }

  private applyMode(mode: QualityMode): void {
    this.currentMode = mode;
    const preset = this.getPreset(mode);
    this.emit("modeChanged", preset);
  }

  getCurrentSettings(): QualitySettings {
    return this.getPreset(this.currentMode);
  }

  getNetworkMetrics(): NetworkMetrics {
    return { ...this.networkMetrics };
  }

  getQualityMode(): QualityMode {
    return this.currentMode;
  }

  setQualityMode(mode: QualityMode): void {
    if (mode !== this.currentMode) {
      this.applyMode(mode);
      log.info({ mode }, "[StreamingQuality] Mode changed");
    }
  }

  updateNetworkMetrics(metrics: Partial<NetworkMetrics>): void {
    const now = Date.now();

    // Update metrics
    this.networkMetrics = {
      ...this.networkMetrics,
      ...metrics,
      condition: this.evaluateNetworkCondition(metrics),
      lastUpdated: now,
    };

    // Recalculate quality score
    this.networkMetrics.qualityScore = this.calculateQualityScore();

    log.debug(
      {
        latency: this.networkMetrics.latencyMs,
        condition: this.networkMetrics.condition,
        score: this.networkMetrics.qualityScore,
      },
      "[StreamingQuality] Network metrics updated"
    );

    // Trigger auto-adaptation if enabled
    if (this.config.enableAdaptive) {
      this.autoAdapt();
    }

    this.emit("metricsUpdated", this.networkMetrics);
  }

  requestQualityIncrease(): void {
    this.qualityRequests.increase++;

    // Accumulate requests over time
    if (this.qualityRequests.increase >= 3) {
      const preset = this.getPreset(this.currentMode);
      if (preset.mode === "low") {
        this.applyMode("balanced");
      } else if (preset.mode === "balanced") {
        this.applyMode("high");
      }
      this.qualityRequests = { increase: 0, decrease: 0 };

      log.info({ mode: this.currentMode, reason: "user_request" }, "[StreamingQuality] Quality increased");
      this.emit("userRequest", { type: "increase", mode: this.currentMode });
    }
  }

  requestQualityDecrease(): void {
    this.qualityRequests.decrease++;

    if (this.qualityRequests.decrease >= 2) {
      const preset = this.getPreset(this.currentMode);
      if (preset.mode === "high") {
        this.applyMode("balanced");
      } else if (preset.mode === "balanced") {
        this.applyMode("low");
      }
      this.qualityRequests = { increase: 0, decrease: 0 };

      log.info({ mode: this.currentMode, reason: "user_request" }, "[StreamingQuality] Quality decreased");
      this.emit("userRequest", { type: "decrease", mode: this.currentMode });
    }
  }

  enable(): void {
    this.enabled = true;
    log.info("[StreamingQuality] Enabled");
    this.emit("enabled");
  }

  disable(): void {
    this.enabled = false;
    log.info("[StreamingQuality] Disabled");
    this.emit("disabled");
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get adaptation trend for analysis.
   */
  getAdaptationTrend(): { direction: "improving" | "stable" | "degrading"; trend: number[] } {
    if (this.adaptationHistory.length < 5) {
      return { direction: "stable", trend: [] };
    }

    const recent = this.adaptationHistory.slice(-5);
    const trend = recent.map(h => h.qualityScore);

    const first = trend[0]!;
    const last = trend[trend.length - 1]!;
    const delta = last - first;

    return {
      direction: delta > 0.05 ? "improving" : delta < -0.05 ? "degrading" : "stable",
      trend,
    };
  }
}

export interface StreamingQuality extends EventEmitter {
  on(event: "modeChanged", listener: (settings: QualitySettings) => void): this;
  on(event: "metricsUpdated", listener: (metrics: NetworkMetrics) => void): this;
  on(event: "qualityAdapted", listener: (info: { mode: QualityMode; score: number }) => void): this;
  on(event: "userRequest", listener: (info: { type: string; mode: QualityMode }) => void): this;
  on(event: "enabled" | "disabled", listener: () => void): this;
  emit(event: "modeChanged", settings: QualitySettings): boolean;
  emit(event: "metricsUpdated", metrics: NetworkMetrics): boolean;
  emit(event: "qualityAdapted", info: { mode: QualityMode; score: number }): boolean;
  emit(event: "userRequest", info: { type: string; mode: QualityMode }): boolean;
  emit(event: "enabled" | "disabled"): boolean;
}

// Singleton export
export const streamingQuality: StreamingQuality = new StreamingQualityImpl();
