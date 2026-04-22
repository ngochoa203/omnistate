/**
 * @omnistate/android — native module barrel
 */

export { AudioRecorder } from "./AudioRecorder";
export { CameraCapture } from "./CameraCapture";
export { AccessibilityModule } from "./AccessibilityModule";
export { ScreenCaptureModule } from "./ScreenCaptureModule";
export { OverlayModule } from "./OverlayModule";
export { AppManagerModule, KNOWN_APPS } from "./AppManagerModule";

export type {
  AudioRecorderConfig,
  AudioRecorderModule,
  StopRecordingResult,
  PermissionStatus as AudioPermissionStatus,
} from "./AudioRecorder";

export type {
  TakePictureOptions,
  TakePictureResult,
  CameraCaptureModule,
  PermissionStatus as CameraPermissionStatus,
} from "./CameraCapture";

export type {
  ScreenNode,
  ElementBounds,
  SystemAction,
  AccessibilityModuleInterface,
} from "./AccessibilityModule";

export type { ScreenCaptureModuleInterface } from "./ScreenCaptureModule";
export type { OverlayModuleInterface } from "./OverlayModule";
export type { KnownApp } from "./AppManagerModule";

export type PermissionStatus = "granted" | "denied" | "undetermined";
