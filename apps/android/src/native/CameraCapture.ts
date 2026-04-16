/**
 * CameraCapture — native camera bridge for OmniState Android.
 *
 * Runtime strategy (in priority order):
 *   1. react-native-image-picker   (recommended — minimal footprint, no UI deps)
 *   2. Dev-mock                    (logs warnings, returns placeholder data)
 *
 * To enable real camera capture:
 *   pnpm add react-native-image-picker
 *   cd apps/android/android && ./gradlew clean
 *
 * Required AndroidManifest.xml permissions (auto-linked by the library,
 * but confirm they are present):
 *   <uses-permission android:name="android.permission.CAMERA" />
 *   <!-- Only needed if saving to external storage: -->
 *   <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
 *                    android:maxSdkVersion="28" />
 *
 * The library also requires the FileProvider configuration in
 * android/app/src/main/res/xml/file_paths.xml (auto-configured by its
 * Gradle plugin in recent versions).
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

export interface TakePictureOptions {
  /**
   * JPEG quality 0–1. Default: 0.85.
   * Translates to 0–100 in the native layer.
   */
  quality?: number;
  /** Which camera to use. Default: 'back'. */
  facing?: 'front' | 'back';
  /**
   * Maximum width of the captured image in pixels.
   * The aspect ratio is preserved. Default: unlimited.
   */
  maxWidth?: number;
  /**
   * Maximum height of the captured image in pixels.
   * The aspect ratio is preserved. Default: unlimited.
   */
  maxHeight?: number;
  /** Include EXIF data in the returned result. Default: false. */
  includeExif?: boolean;
}

export interface TakePictureResult {
  /** file:// URI pointing to the captured JPEG. */
  uri: string;
  /** Pixel width of the image. */
  width: number;
  /** Pixel height of the image. */
  height: number;
  /** File size in bytes (-1 when unavailable). */
  fileSize: number;
  /** MIME type, e.g. "image/jpeg". */
  type: string;
}

export interface CameraCaptureModule {
  /**
   * Open the camera and capture a single photo.
   * Rejects if the user cancels, permission is denied, or hardware is unavailable.
   */
  takePicture(options?: TakePictureOptions): Promise<TakePictureResult>;

  /** Returns current camera permission state without prompting. */
  getPermissionStatus(): Promise<PermissionStatus>;

  /**
   * Prompt the user for camera permission.
   * Returns true if permission was granted.
   */
  requestPermission(): Promise<boolean>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function warn(msg: string): void {
  console.warn(`[CameraCapture] ${msg}`);
}

// ── Permission helpers ────────────────────────────────────────────────────────

async function checkAndroidCameraPermission(): Promise<PermissionStatus> {
  if (Platform.OS !== 'android') return 'undetermined';
  const granted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.CAMERA,
  );
  return granted ? 'granted' : 'denied';
}

async function requestAndroidCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: 'Camera Permission',
      message: 'OmniState needs camera access to capture images.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// ── Real implementation via react-native-image-picker ────────────────────────

// Minimal shape of the API we consume from react-native-image-picker v7+
type ImagePickerResponse = {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: Array<{
    uri?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    type?: string;
  }>;
};

type ImagePickerOptions = {
  mediaType: 'photo';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  cameraType?: 'front' | 'back';
  includeExif?: boolean;
  saveToPhotos?: boolean;
};

type LaunchCameraFn = (
  options: ImagePickerOptions,
  callback: (response: ImagePickerResponse) => void,
) => void;

function tryLoadImagePicker(): LaunchCameraFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-image-picker') as Record<string, unknown>;
    const fn = (mod['launchCamera'] ?? (mod['default'] as Record<string, unknown>)?.['launchCamera']) as LaunchCameraFn | undefined;
    if (typeof fn === 'function') return fn;
  } catch {
    // Not installed
  }
  return null;
}

function buildRealModule(launchCamera: LaunchCameraFn): CameraCaptureModule {
  return {
    async takePicture(options = {}) {
      const granted = await requestAndroidCameraPermission();
      if (!granted) throw new Error('Camera permission denied');

      const pickerOptions: ImagePickerOptions = {
        mediaType: 'photo',
        quality: options.quality ?? 0.85,
        cameraType: options.facing ?? 'back',
        saveToPhotos: false,
        ...(options.maxWidth != null ? { maxWidth: options.maxWidth } : {}),
        ...(options.maxHeight != null ? { maxHeight: options.maxHeight } : {}),
        ...(options.includeExif != null ? { includeExif: options.includeExif } : {}),
      };

      return new Promise<TakePictureResult>((resolve, reject) => {
        launchCamera(pickerOptions, (response) => {
          if (response.didCancel) {
            reject(new Error('User cancelled camera'));
            return;
          }
          if (response.errorCode) {
            reject(
              new Error(`Camera error (${response.errorCode}): ${response.errorMessage}`),
            );
            return;
          }
          const asset = response.assets?.[0];
          if (!asset?.uri) {
            reject(new Error('Camera returned no asset'));
            return;
          }
          resolve({
            uri: asset.uri,
            width: asset.width ?? 0,
            height: asset.height ?? 0,
            fileSize: asset.fileSize ?? -1,
            type: asset.type ?? 'image/jpeg',
          });
        });
      });
    },

    async getPermissionStatus() {
      return checkAndroidCameraPermission();
    },

    async requestPermission() {
      return requestAndroidCameraPermission();
    },
  };
}

// ── Dev-mock implementation ───────────────────────────────────────────────────

function buildMockModule(): CameraCaptureModule {
  const INSTALL_HINT =
    'Install react-native-image-picker for real camera support:\n' +
    '  pnpm add react-native-image-picker\n' +
    '  cd apps/android/android && ./gradlew clean';

  return {
    async takePicture(options = {}) {
      warn(`Using dev-mock — no camera is opened.\n${INSTALL_HINT}`);
      // Return a deterministic placeholder so downstream code can render something
      const facing = options.facing ?? 'back';
      const fakeUri = `file:///tmp/omnistate_mock_${facing}_${Date.now()}.jpg`;
      const result: TakePictureResult = {
        uri: fakeUri,
        width: 1280,
        height: 720,
        fileSize: 0,
        type: 'image/jpeg',
      };
      warn(`takePicture (mock) → ${JSON.stringify(result)}`);
      return result;
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

// ── Module factory ────────────────────────────────────────────────────────────

function createCameraCapture(): CameraCaptureModule {
  // 1. Preferred library
  const launchCamera = tryLoadImagePicker();
  if (launchCamera) {
    return buildRealModule(launchCamera);
  }

  // 2. Sanity-check raw NativeModules (helps diagnose partial installs)
  if (NativeModules.RNCameraRoll || NativeModules.ImagePickerManager) {
    warn(
      'Found a camera NativeModule but the JS package is missing — ' +
      'try: pnpm add react-native-image-picker',
    );
  }

  // 3. Dev-mock fallback
  warn(
    'react-native-image-picker not found — using dev-mock.\n' +
    'Run: pnpm add react-native-image-picker',
  );
  return buildMockModule();
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const CameraCapture: CameraCaptureModule = createCameraCapture();
