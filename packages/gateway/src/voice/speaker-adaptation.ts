import { childLogger } from "../utils/logger.js";
import { cosineSimilarity } from "./verification.js";

const log = childLogger("speaker-adaptation");

export interface AdaptationConfig {
  enabled: boolean;
  learningRate: number;
  maxSamples: number;
  minVerificationScore: number;
  adaptationWindowDays: number;
  autoAdapt: boolean;
  autoAdaptThreshold: number;
}

export interface AdaptationMetrics {
  totalVerifications: number;
  successfulAdaptations: number;
  averageConfidenceGain: number;
  lastAdaptationDate?: number;
  currentLearningRate: number;
  sampleCount: number;
}

export interface SpeakerAdaptation {
  recordVerification(userId: string, embedding: number[], score: number): void;
  getAdaptedEmbedding(userId: string): number[] | null;
  hasEnoughSamples(userId: string): boolean;
  adapt(userId: string): boolean;
  getMetrics(userId: string): AdaptationMetrics;
  resetUser(userId: string): void;
  getStatistics(): { totalUsers: number; totalVerifications: number; averageLearningRate: number };
}

interface SampleEntry {
  embedding: number[];
  score: number;
  timestamp: number;
}

interface UserAdaptationData {
  samples: SampleEntry[];
  currentEmbedding: number[] | null;
  successfulAdaptations: number;
  totalVerifications: number;
  averageConfidenceGain: number;
  lastAdaptationDate?: number;
}

const DEFAULT_CONFIG: AdaptationConfig = {
  enabled: true,
  learningRate: 0.2,
  maxSamples: 50,
  minVerificationScore: 0.8,
  adaptationWindowDays: 30,
  autoAdapt: true,
  autoAdaptThreshold: 5,
};

class SpeakerAdaptationImpl implements SpeakerAdaptation {
  private config: AdaptationConfig;
  private userData = new Map<string, UserAdaptationData>();
  private globalStats = {
    totalVerifications: 0,
    averageLearningRate: 0,
  };

  constructor(config?: Partial<AdaptationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getOrCreateUserData(userId: string): UserAdaptationData {
    let data = this.userData.get(userId);
    if (!data) {
      data = {
        samples: [],
        currentEmbedding: null,
        successfulAdaptations: 0,
        totalVerifications: 0,
        averageConfidenceGain: 0,
      };
      this.userData.set(userId, data);
    }
    return data;
  }

  private cleanExpiredSamples(userData: UserAdaptationData): void {
    const windowMs = this.config.adaptationWindowDays * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    userData.samples = userData.samples.filter((s) => s.timestamp >= cutoff);

    if (userData.samples.length > this.config.maxSamples) {
      userData.samples = userData.samples.slice(-this.config.maxSamples);
    }
  }

  private adaptEmbedding(userData: UserAdaptationData): number[] {
    const { samples } = userData;
    if (samples.length === 0) {
      return [];
    }

    // Weight by score (higher score = more weight)
    const totalWeight = samples.reduce((sum, s) => sum + s.score, 0);
    const dim = samples[0]!.embedding.length;
    const weightedSum = new Array(dim).fill(0);

    for (const sample of samples) {
      const weight = (sample.score * sample.score) / totalWeight; // Square for stronger weighting
      for (let i = 0; i < dim; i++) {
        weightedSum[i]! += sample.embedding[i]! * weight;
      }
    }

    // Normalize
    const norm = Math.sqrt(weightedSum.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      return weightedSum.map((v) => v / norm);
    }

    return weightedSum;
  }

  private calculateEffectiveLearningRate(userData: UserAdaptationData): number {
    // Adaptive learning rate: decreases with more samples
    const baseRate = this.config.learningRate;
    const decayFactor = 1 + userData.samples.length * 0.1;
    return baseRate / decayFactor;
  }

  recordVerification(userId: string, embedding: number[], score: number): void {
    if (!this.config.enabled) return;

    const userData = this.getOrCreateUserData(userId);
    userData.totalVerifications++;
    this.globalStats.totalVerifications++;

    // Clean expired samples
    this.cleanExpiredSamples(userData);

    // Only record if score meets threshold
    if (score < this.config.minVerificationScore) {
      log.debug(
        { userId, score, minRequired: this.config.minVerificationScore },
        "Score below threshold - not recording for adaptation"
      );
      return;
    }

    // Add sample
    userData.samples.push({
      embedding: [...embedding],
      score,
      timestamp: Date.now(),
    });

    log.debug(
      { userId, score, sampleCount: userData.samples.length },
      "Verification recorded for adaptation"
    );

    // Update current embedding using exponential moving average
    if (userData.currentEmbedding && userData.currentEmbedding.length > 0) {
      const effectiveRate = this.calculateEffectiveLearningRate(userData);
      const newEmbedding = userData.currentEmbedding.map((v, i) =>
        v * (1 - effectiveRate) + embedding[i]! * effectiveRate
      );
      userData.currentEmbedding = newEmbedding;
    } else {
      userData.currentEmbedding = [...embedding];
    }

    // Auto-adapt check
    if (this.config.autoAdapt && userData.samples.length >= this.config.autoAdaptThreshold) {
      this.adapt(userId);
    }
  }

  getAdaptedEmbedding(userId: string): number[] | null {
    const userData = this.userData.get(userId);
    if (!userData) return null;

    // If we have updated embedding, use it
    if (userData.currentEmbedding) {
      return userData.currentEmbedding;
    }

    // Otherwise compute from samples
    if (userData.samples.length === 0) return null;

    return this.adaptEmbedding(userData);
  }

  hasEnoughSamples(userId: string): boolean {
    const userData = this.userData.get(userId);
    if (!userData) return false;

    this.cleanExpiredSamples(userData);
    return userData.samples.length >= this.config.autoAdaptThreshold;
  }

  adapt(userId: string): boolean {
    const userData = this.userData.get(userId);
    if (!userData || userData.samples.length === 0) {
      log.debug({ userId }, "Cannot adapt - no samples");
      return false;
    }

    const oldEmbedding = userData.currentEmbedding;
    const newEmbedding = this.adaptEmbedding(userData);

    if (oldEmbedding && oldEmbedding.length > 0) {
      const similarityGain = cosineSimilarity(newEmbedding, oldEmbedding);
      userData.averageConfidenceGain =
        (userData.averageConfidenceGain * userData.successfulAdaptations + similarityGain) /
        (userData.successfulAdaptations + 1);
    }

    userData.currentEmbedding = newEmbedding;
    userData.successfulAdaptations++;
    userData.lastAdaptationDate = Date.now();

    // Clear old samples, keep new embedding as base
    userData.samples = [];

    log.info(
      { userId, successfulAdaptations: userData.successfulAdaptations },
      "Speaker embedding adapted"
    );

    return true;
  }

  getMetrics(userId: string): AdaptationMetrics {
    const userData = this.userData.get(userId);
    if (!userData) {
      return {
        totalVerifications: 0,
        successfulAdaptations: 0,
        averageConfidenceGain: 0,
        currentLearningRate: this.config.learningRate,
        sampleCount: 0,
      };
    }

    return {
      totalVerifications: userData.totalVerifications,
      successfulAdaptations: userData.successfulAdaptations,
      averageConfidenceGain: userData.averageConfidenceGain,
      lastAdaptationDate: userData.lastAdaptationDate,
      currentLearningRate: this.calculateEffectiveLearningRate(userData),
      sampleCount: userData.samples.length,
    };
  }

  resetUser(userId: string): void {
    this.userData.delete(userId);
    log.info({ userId }, "Speaker adaptation data reset");
  }

  getStatistics(): { totalUsers: number; totalVerifications: number; averageLearningRate: number } {
    return {
      totalUsers: this.userData.size,
      totalVerifications: this.globalStats.totalVerifications,
      averageLearningRate: this.globalStats.averageLearningRate,
    };
  }
}

// Singleton export
export const speakerAdaptation: SpeakerAdaptation = new SpeakerAdaptationImpl();
