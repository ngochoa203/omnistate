/**
 * @omnistate/android — native module barrel
 *
 * Exports all JS-side native bridges in one import:
 *
 *   import { AudioRecorder, CameraCapture } from '../native';
 *   import type { AudioRecorderConfig, TakePictureOptions } from '../native';
 */

// ── Modules ───────────────────────────────────────────────────────────────────

export { AudioRecorder } from './AudioRecorder';
export { CameraCapture } from './CameraCapture';

// ── Types — AudioRecorder ─────────────────────────────────────────────────────

export type {
  AudioRecorderConfig,
  AudioRecorderModule,
  StopRecordingResult,
  /** Re-export with the AudioRecorder prefix to avoid name clashes */
  PermissionStatus as AudioPermissionStatus,
} from './AudioRecorder';

// ── Types — CameraCapture ─────────────────────────────────────────────────────

export type {
  TakePictureOptions,
  TakePictureResult,
  CameraCaptureModule,
  /** Re-export with the Camera prefix to avoid name clashes */
  PermissionStatus as CameraPermissionStatus,
} from './CameraCapture';

// ── Unified permission status ─────────────────────────────────────────────────
// Both modules use the same three-state enum — export it once for consumers
// that don't care which module they're talking to.

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';
