/**
 * AudioRecorder — native audio recording bridge for OmniState Android.
 *
 * Runtime strategy (in priority order):
 *   1. react-native-audio-recorder-player  (preferred — install when ready)
 *   2. @react-native-voice/voice           (voice-optimised alternative)
 *   3. Dev-mock                            (logs warnings, returns fake data)
 *
 * To enable real recording:
 *   pnpm add react-native-audio-recorder-player
 *   Android: cd apps/android/android && ./gradlew clean
 *   iOS:     cd apps/android/ios && pod install
 *
 * Required AndroidManifest.xml permissions (added by the lib's auto-linking,
 * but confirm they are present):
 *   <uses-permission android:name="android.permission.RECORD_AUDIO" />
 *   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
 *
 * Required iOS Info.plist keys (already present in ios/OmniState/Info.plist):
 *   NSMicrophoneUsageDescription
 */

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

// React Native runs on a Node/Hermes runtime that always has `require` and
// `console`, but the project's tsconfig targets ESNext without DOM or Node
// lib. Declare them here so TypeScript is satisfied without pulling in
// @types/node or "lib": ["dom"] — which would conflict with RN's types.
declare function require(module: string): unknown;
declare const console: { warn: (...args: unknown[]) => void };

// ── Types ─────────────────────────────────────────────────────────────────────

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface AudioRecorderConfig {
  /** Sample rate in Hz. Default: 16000 (optimal for speech recognition). */
  sampleRate?: number;
  /** Number of channels. Default: 1 (mono). */
  channels?: number;
  /** Bit depth. Default: 16. */
  bitDepth?: number;
  /** Maximum recording duration in seconds. Default: 30. */
  maxDuration?: number;
  /** Output file path. Default: cache dir + /omnistate_audio.mp4 */
  outputPath?: string;
}

export interface StopRecordingResult {
  /** File URI usable with fetch() / FormData. */
  uri: string;
  /** Actual recorded duration in milliseconds. */
  duration: number;
  /** File size in bytes (-1 when unavailable). */
  size: number;
}

export interface AudioRecorderModule {
  /**
   * Begin recording. Rejects if permission is not granted or if a recording
   * is already in progress.
   */
  startRecording(config?: AudioRecorderConfig): Promise<void>;

  /**
   * Stop the active recording and return metadata.
   * Rejects if no recording is in progress.
   */
  stopRecording(): Promise<StopRecordingResult>;

  /** Returns true when a recording session is active. */
  isRecording(): Promise<boolean>;

  /** Returns the current microphone permission state without prompting. */
  getPermissionStatus(): Promise<PermissionStatus>;

  /**
   * Prompt the user for microphone permission.
   * Returns true if permission was granted.
   */
  requestPermission(): Promise<boolean>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<AudioRecorderConfig> = {
  sampleRate: 16_000,
  channels: 1,
  bitDepth: 16,
  maxDuration: 30,
  outputPath: '',
};

function mergeConfig(partial?: AudioRecorderConfig): Required<AudioRecorderConfig> {
  return { ...DEFAULT_CONFIG, ...partial };
}

function warn(msg: string): void {
  console.warn(`[AudioRecorder] ${msg}`);
}

// ── Permission helpers (Android-only; iOS is handled by the native lib) ───────

async function checkAndroidPermission(): Promise<PermissionStatus> {
  if (Platform.OS !== 'android') return 'undetermined';
  const result = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  return result ? 'granted' : 'denied';
}

async function requestAndroidPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message: 'OmniState needs microphone access to record voice commands.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// ── Real implementation via react-native-audio-recorder-player ───────────────

type AudioRecorderPlayer = {
  startRecorder(path: string, audioSet?: Record<string, unknown>): Promise<string>;
  stopRecorder(): Promise<string>;
  addRecordBackListener(cb: (e: { currentPosition: number }) => void): void;
  removeRecordBackListener(): void;
};

function tryLoadRNARP(): AudioRecorderPlayer | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-audio-recorder-player') as Record<string, unknown>;
    const ctor = (mod['default'] ?? mod['AudioRecorderPlayer'] ?? mod) as (new () => AudioRecorderPlayer) | undefined;
    if (typeof ctor === 'function') {
      return new ctor() as AudioRecorderPlayer;
    }
  } catch {
    // Not installed — fall through to mock
  }
  return null;
}

function buildRealModule(player: AudioRecorderPlayer): AudioRecorderModule {
  let _recording = false;
  let _startedAt = 0;

  return {
    async startRecording(config) {
      if (_recording) throw new Error('Already recording');
      const cfg = mergeConfig(config);

      const granted = await requestAndroidPermission();
      if (!granted) throw new Error('Microphone permission denied');

      // AudioSet maps to Android MediaRecorder / iOS AVFoundation options
      const audioSet = {
        AudioSamplingRateAndroid: cfg.sampleRate,
        AudioChannelsAndroid: cfg.channels,
        AudioEncoderAndroid: 3, // AAC
        AudioSourceAndroid: 6,  // MIC
        OutputFormatAndroid: 2, // MPEG_4
        AVSampleRateKeyIOS: cfg.sampleRate,
        AVNumberOfChannelsKeyIOS: cfg.channels,
        AVEncoderAudioQualityKeyIOS: 127, // max
      };

      const path =
        cfg.outputPath ||
        `${Platform.OS === 'android' ? 'sdcard' : 'documents'}/omnistate_${Date.now()}.mp4`;

      await player.startRecorder(path, audioSet);
      _recording = true;
      _startedAt = Date.now();
    },

    async stopRecording() {
      if (!_recording) throw new Error('Not recording');
      const uri = await player.stopRecorder();
      const duration = Date.now() - _startedAt;
      _recording = false;
      return { uri, duration, size: -1 };
    },

    async isRecording() {
      return _recording;
    },

    async getPermissionStatus() {
      // On iOS the native library handles permissions; return 'undetermined'
      // so callers know to call requestPermission() first.
      if (Platform.OS !== 'android') return 'undetermined' as PermissionStatus;
      return checkAndroidPermission();
    },

    async requestPermission() {
      // On iOS the native library will prompt natively when recording starts.
      if (Platform.OS !== 'android') return true;
      return requestAndroidPermission();
    },
  };
}

// ── Dev-mock implementation ───────────────────────────────────────────────────
//
// Returns fake data so the UI can be built / demoed without native deps.
// Emits a console.warn to make the situation visible.

function buildMockModule(): AudioRecorderModule {
  let _recording = false;
  let _startedAt = 0;

  const INSTALL_HINT =
    'Install react-native-audio-recorder-player for real recording:\n' +
    '  pnpm add react-native-audio-recorder-player\n' +
    '  cd apps/android/android && ./gradlew clean';

  return {
    async startRecording() {
      if (_recording) throw new Error('Already recording');
      warn(`Using dev-mock — no audio is captured.\n${INSTALL_HINT}`);
      _recording = true;
      _startedAt = Date.now();
    },

    async stopRecording() {
      if (!_recording) throw new Error('Not recording');
      const duration = Date.now() - _startedAt;
      _recording = false;
      // Return a data URI that is recognisably fake
      const fakeUri = `file:///tmp/omnistate_mock_${Date.now()}.mp4`;
      warn(`stopRecording (mock) → uri=${fakeUri} duration=${duration}ms`);
      return { uri: fakeUri, duration, size: 0 };
    },

    async isRecording() {
      return _recording;
    },

    async getPermissionStatus(): Promise<PermissionStatus> {
      warn('getPermissionStatus (mock) → returning "granted"');
      return 'granted';
    },

    async requestPermission() {
      warn('requestPermission (mock) → returning true');
      return true;
    },
  };
}

// ── Module factory ─────────────────────────────────────────────────────────────

function createAudioRecorder(): AudioRecorderModule {
  // 1. Try the preferred native library
  const player = tryLoadRNARP();
  if (player) {
    return buildRealModule(player);
  }

  // 2. Check if RN's own NativeModules exposes something (uncommon in bare RN)
  if (NativeModules.RNAudioRecorderPlayer) {
    // Shouldn't normally reach here if the require above failed, but be safe.
    warn('Found NativeModules.RNAudioRecorderPlayer but failed to require() the JS package.');
  }

  // 3. Fall back to mock
  warn(
    'react-native-audio-recorder-player not found — using dev-mock.\n' +
    'Run: pnpm add react-native-audio-recorder-player',
  );
  return buildMockModule();
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const AudioRecorder: AudioRecorderModule = createAudioRecorder();
