/**
 * Surface Layer — vision-based UI interaction via Rust N-API bindings.
 *
 * Captures the screen using zero-copy GPU framebuffer access (IOSurface),
 * detects UI elements via accessibility API + vision model,
 * and operates mouse/keyboard like a human.
 *
 * Data flow for capture:
 *   GPU framebuffer -> IOSurface (zero-copy) -> Node.js Buffer -> base64 (for vision)
 *
 * Data flow for interaction:
 *   TypeScript command -> N-API -> Rust -> CGEvent/AXUIElement -> macOS
 */

import * as bridge from "../platform/bridge.js";
import { fingerprintTree } from "../vision/fingerprint.js";
import { detectByFingerprint as _detectByFingerprint } from "../vision/detect.js";

type Modifiers = Array<'command' | 'shift' | 'option' | 'control' | 'fn'>;

export class SurfaceLayer {
  /** Check if the native bridge is available. */
  get isAvailable(): boolean {
    return bridge.isNativeAvailable();
  }

  /**
   * Capture the current screen using zero-copy GPU framebuffer access.
   *
   * On Apple Silicon, this reads directly from GPU unified memory via IOSurface.
   * Returns metadata and the raw pixel buffer.
   */
  async captureScreen(): Promise<ScreenCapture> {
    // Use zero-copy capture (ScreenCaptureKit + IOSurface) as primary path
    try {
      const meta = bridge.captureFrameZeroCopy();
      const buffer = bridge.captureFrameZeroCopyBuffer();
      return {
        width: meta.width,
        height: meta.height,
        data: buffer,
        timestampMs: Date.now(),
        captureMethod: "zero-copy-iosurface",
        bytesPerRow: meta.bytesPerRow,
        pixelFormat: meta.pixelFormat,
      };
    } catch {
      // Fallback to traditional CGDisplay capture
      const meta = bridge.captureScreen();
      const buffer = bridge.captureScreenBuffer();
      return {
        width: meta.width,
        height: meta.height,
        data: buffer,
        timestampMs: Date.now(),
        captureMethod: "cgdisplay",
      };
    }
  }

  /** Capture a specific window by its platform window ID. */
  async captureWindow(windowId: number): Promise<ScreenCapture> {
    const windows = await this.listWindows();
    const target = windows.find((w) => w.id === windowId);
    if (!target) {
      throw new Error(`Window ${windowId} not found`);
    }

    const region = await this.captureRegion(
      target.bounds.x,
      target.bounds.y,
      target.bounds.width,
      target.bounds.height
    );

    return {
      ...region,
      captureMethod: "window",
    };
  }

  /** Capture a rectangular region of the screen. */
  async captureRegion(
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<ScreenCapture> {
    // Native bridge currently exposes metadata-only region capture.
    // Crop from a full-frame buffer so callers always receive real pixels.
    const full = await this.captureScreen();
    const cropped = cropBufferRegion(
      full.data,
      full.width,
      full.height,
      x,
      y,
      width,
      height,
      full.bytesPerRow
    );

    return {
      width: cropped.width,
      height: cropped.height,
      data: cropped.data,
      timestampMs: Date.now(),
      captureMethod: "region",
      bytesPerRow: cropped.width * 4,
      pixelFormat: full.pixelFormat,
    };
  }

  /** List all visible windows on screen. */
  async listWindows(): Promise<WindowInfo[]> {
    const windows = bridge.listWindows();
    return windows;
  }

  /**
   * Find a UI element by description.
   *
   * Priority:
   * 1. Fingerprint store — structural identity match (survives colour/theme changes)
   * 2. Accessibility API (fast, accurate, free)
   * 3. Vision model (slower, costs API call, but understands semantics)
   *
   * Before searching, the accessibility tree is re-walked and all component
   * fingerprints are refreshed so subsequent calls benefit from the latest
   * structural snapshot.
   */
  async findElement(description: string): Promise<DetectedElement | null> {
    // ── Step 1: Refresh the accessibility tree and re-fingerprint ────────────
    try {
      if (bridge.isNativeAvailable()) {
        const rawTree = bridge.getUiTree() as Record<string, unknown> | null | undefined;
        if (rawTree) {
          fingerprintTree(rawTree);
        }
      }
    } catch {
      // Fingerprint refresh failed — continue with stale store or empty store.
    }

    // ── Step 2: Fingerprint-based detection (structural, most reliable) ───────
    const fpResult = _detectByFingerprint(description);
    if (fpResult && fpResult.confidence > 0.5) {
      return fpResult;
    }

    // ── Step 3: Accessibility API direct lookup ───────────────────────────────
    try {
      const element = bridge.findElement(description) as Record<
        string,
        unknown
      > | null;
      if (element) {
        return {
          id: String(element.title ?? ""),
          type: String(element.role ?? "unknown"),
          bounds: element.bounds as {
            x: number;
            y: number;
            width: number;
            height: number;
          },
          text: element.title as string | undefined,
          confidence: 0.95,
          detectionMethod: "accessibility",
        };
      }
    } catch {
      // Accessibility not available — fall through to vision.
    }

    // ── Step 4: Accessibility tree scan (broader text/role match) ────────────
    try {
      if (bridge.isNativeAvailable()) {
        const allElements = bridge.getUiElements() as Array<Record<string, unknown>>;
        const queryLower = description.toLowerCase();
        const matched = allElements.find((el) => {
          const title = String(el.title ?? "").toLowerCase();
          const role = String(el.role ?? "").toLowerCase();
          const isBoundsValid =
            typeof el.bounds === "object" &&
            el.bounds !== null &&
            ["x", "y", "width", "height"].every(
              (k) => typeof (el.bounds as Record<string, unknown>)[k] === "number"
            );
          return (title.includes(queryLower) || role.includes(queryLower)) && isBoundsValid;
        });
        if (matched) {
          return {
            id: String(matched.title ?? ""),
            type: String(matched.role ?? "unknown"),
            bounds: matched.bounds as { x: number; y: number; width: number; height: number },
            text: matched.title as string | undefined,
            confidence: 0.85,
            detectionMethod: "accessibility",
          };
        }
      }
    } catch {
      // Fall through.
    }

    // TODO: Vision model fallback (Sprint 3)
    return null;
  }

  /** Get all UI elements from the accessibility tree. */
  async getUIElements(): Promise<DetectedElement[]> {
    try {
      const elements = bridge.getUiElements() as Array<
        Record<string, unknown>
      >;
      return elements.map((el) => ({
        id: String(el.title ?? ""),
        type: String(el.role ?? "unknown"),
        bounds: el.bounds as {
          x: number;
          y: number;
          width: number;
          height: number;
        },
        text: el.title as string | undefined,
        confidence: 1.0,
        detectionMethod: "accessibility",
      }));
    } catch {
      return [];
    }
  }

  /** Click on a detected element. */
  async clickElement(element: DetectedElement): Promise<void> {
    // Refresh fingerprints so the store reflects the latest UI state.
    try {
      if (bridge.isNativeAvailable()) {
        const rawTree = bridge.getUiTree() as Record<string, unknown> | null | undefined;
        if (rawTree) {
          fingerprintTree(rawTree);
        }
      }
    } catch {
      /* continue with existing state */
    }

    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;

    // Move mouse smoothly to element center (human-like Bezier curve)
    bridge.moveMouseSmooth(
      centerX - 50, // Start slightly off-target
      centerY - 30,
      centerX,
      centerY,
      15 // steps
    );

    // Small delay then click
    await sleep(50);
    bridge.click("left");
  }

  /** Double-click on a detected element. */
  async doubleClickElement(element: DetectedElement): Promise<void> {
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;

    bridge.moveMouse(centerX, centerY);
    await sleep(30);
    bridge.doubleClick("left");
  }

  /** Move mouse to absolute coordinates. */
  async moveMouse(x: number, y: number): Promise<void> {
    bridge.moveMouse(x, y);
  }

  /** Move mouse smoothly along a Bezier curve. */
  async moveMouseSmooth(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    steps: number = 20
  ): Promise<void> {
    bridge.moveMouseSmooth(fromX, fromY, toX, toY, steps);
  }

  /** Click at current mouse position. */
  async click(button: "left" | "right" | "middle" = "left"): Promise<void> {
    bridge.click(button);
  }

  /** Scroll the mouse wheel. */
  async scroll(dx: number, dy: number): Promise<void> {
    bridge.scroll(dx, dy);
  }

  /** Drag from one point to another. */
  async drag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): Promise<void> {
    bridge.drag(fromX, fromY, toX, toY);
  }

  /** Press a key with optional modifiers. */
  async keyTap(
    key: string,
    modifiers: {
      shift?: boolean;
      control?: boolean;
      alt?: boolean;
      meta?: boolean;
    } = {}
  ): Promise<void> {
    bridge.keyTap(key, modifiers);
  }

  // ── Keyboard (raw key events) ──────────────────────────────
  async keyDown(key: string, modifiers: Modifiers = []): Promise<void> {
    const bridge = await import('../platform/bridge.js');
    bridge.keyDown(key, this.modifiersToBridge(modifiers));
  }

  async keyUp(key: string, modifiers: Modifiers = []): Promise<void> {
    const bridge = await import('../platform/bridge.js');
    bridge.keyUp(key, this.modifiersToBridge(modifiers));
  }

  async holdKey(key: string, durationMs: number, modifiers: Modifiers = []): Promise<void> {
    await this.keyDown(key, modifiers);
    await new Promise(r => setTimeout(r, durationMs));
    await this.keyUp(key, modifiers);
  }

  // ── Desktop / Space navigation (macOS) ─────────────────────
  async switchDesktop(direction: 'left' | 'right'): Promise<void> {
    const key = direction === 'left' ? 'left' : 'right';
    await this.keyDown(key, ['control']);
    await new Promise(r => setTimeout(r, 50));
    await this.keyUp(key, ['control']);
  }

  async missionControl(): Promise<void> {
    await this.keyDown('up', ['control']);
    await new Promise(r => setTimeout(r, 50));
    await this.keyUp('up', ['control']);
  }

  async showDesktop(): Promise<void> {
    // F11 or Fn+F11 depending on keyboard settings
    await this.keyDown('f11', ['fn']);
    await new Promise(r => setTimeout(r, 50));
    await this.keyUp('f11', ['fn']);
  }

  async switchDisplay(displayIndex: number): Promise<void> {
    // Move mouse to center of target display to activate it
    const { execSync } = await import('child_process');
    try {
      const info = execSync(
        `system_profiler SPDisplaysDataType -json 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const parsed = JSON.parse(info);
      const displays = parsed?.SPDisplaysDataType?.[0]?.spdisplays_ndrvs ?? [];
      if (displayIndex >= 0 && displayIndex < displays.length) {
        const res = displays[displayIndex]?._spdisplays_resolution;
        if (res) {
          const match = res.match(/(\d+)\s*x\s*(\d+)/);
          if (match) {
            const cx = Math.round(parseInt(match[1]) / 2);
            const cy = Math.round(parseInt(match[2]) / 2);
            const bridge = await import('../platform/bridge.js');
            bridge.moveMouse(cx, cy);
          }
        }
      }
    } catch {
      // Fallback: ignore if display info unavailable
    }
  }

  async goToDesktop(desktopNumber: number): Promise<void> {
    // macOS: Ctrl+<number> switches to that desktop/space
    // Must be enabled in System Preferences > Keyboard > Shortcuts > Mission Control
    if (desktopNumber >= 1 && desktopNumber <= 9) {
      const key = String(desktopNumber);
      await this.keyDown(key, ['control']);
      await new Promise(r => setTimeout(r, 50));
      await this.keyUp(key, ['control']);
    }
  }

  // ── Private helpers for keyboard ───────────────────────────
  private modifiersToBridge(mods: Modifiers): {
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
  } {
    return {
      shift: mods.includes('shift'),
      control: mods.includes('control'),
      alt: mods.includes('option'),
      meta: mods.includes('command'),
    };
  }

  /** Type a string of text with human-like delays. */
  async typeText(text: string): Promise<void> {
    bridge.typeText(text);
  }

  /** Check if accessibility permissions are granted. */
  isAccessibilityTrusted(): boolean {
    return bridge.isAccessibilityTrusted();
  }

  // ── Window Geometry Management ─────────────────────────────

  /** Get window geometry info for an app (frontmost app if omitted). */
  async getWindowInfo(appName?: string): Promise<{ app: string; title: string; position: [number, number]; size: [number, number]; minimized: boolean; fullscreen: boolean } | null> {
    const { execSync } = await import('child_process');
    try {
      const target = appName
        ? `tell process "${appName}"`
        : `tell (first process whose frontmost is true)`;
      const script = `
        tell application "System Events"
          ${target}
            if (count of windows) = 0 then return ""
            set w to front window
            set pos to position of w
            set sz to size of w
            set ttl to name of w
            set mini to miniaturized of w
            set fs to value of attribute "AXFullScreen" of w
            set nm to name of it
            return nm & "|" & ttl & "|" & (item 1 of pos) & "|" & (item 2 of pos) & "|" & (item 1 of sz) & "|" & (item 2 of sz) & "|" & mini & "|" & fs
          end tell
        end tell`;
      const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (!raw) return null;
      const parts = raw.split('|');
      if (parts.length < 8) return null;
      return {
        app: parts[0],
        title: parts[1],
        position: [parseInt(parts[2]), parseInt(parts[3])],
        size: [parseInt(parts[4]), parseInt(parts[5])],
        minimized: parts[6].trim() === 'true',
        fullscreen: parts[7].trim() === 'true',
      };
    } catch {
      return null;
    }
  }

  /** Resize the front window of an app (frontmost app if omitted). */
  async resizeWindow(width: number, height: number, appName?: string): Promise<void> {
    const { execSync } = await import('child_process');
    const target = appName ? `tell process "${appName}"` : `tell (first process whose frontmost is true)`;
    const script = `tell application "System Events"\n${target}\nset size of front window to {${width}, ${height}}\nend tell\nend tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
  }

  /** Move the front window of an app to coordinates (frontmost app if omitted). */
  async repositionWindow(x: number, y: number, appName?: string): Promise<void> {
    const { execSync } = await import('child_process');
    const target = appName ? `tell process "${appName}"` : `tell (first process whose frontmost is true)`;
    const script = `tell application "System Events"\n${target}\nset position of front window to {${x}, ${y}}\nend tell\nend tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
  }

  /** Minimize the front window of an app (frontmost app if omitted). */
  async minimizeWindow(appName?: string): Promise<void> {
    const { execSync } = await import('child_process');
    if (appName) {
      const script = `tell application "${appName}" to set miniaturized of front window to true`;
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    } else {
      const script = `tell application "System Events" to tell (first process whose frontmost is true) to set miniaturized of front window to true`;
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    }
  }

  /** Maximize (zoom) the front window of an app (frontmost app if omitted). */
  async maximizeWindow(appName?: string): Promise<void> {
    const { execSync } = await import('child_process');
    const target = appName ? `tell process "${appName}"` : `tell (first process whose frontmost is true)`;
    // Click the green zoom button (button 3 of every macOS window)
    const script = `tell application "System Events"\n${target}\nif (count of windows) > 0 then\nclick button 3 of front window\nend if\nend tell\nend tell`;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
  }

  /** Close the front window of an app (frontmost app if omitted). */
  async closeWindow(appName?: string): Promise<void> {
    const { execSync } = await import('child_process');
    if (appName) {
      const script = `tell application "${appName}" to close front window`;
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    } else {
      const script = `tell application "System Events" to tell (first process whose frontmost is true) to click button 1 of front window`;
      execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
    }
  }

  /** List windows of an app (frontmost app if omitted). */
  async listWindowsForApp(appName?: string): Promise<Array<{ title: string; index: number; position: [number, number]; size: [number, number]; minimized: boolean }>> {
    const { execSync } = await import('child_process');
    try {
      const target = appName ? `tell process "${appName}"` : `tell (first process whose frontmost is true)`;
      const script = `
        tell application "System Events"
          ${target}
            set result to {}
            set winCount to count of windows
            repeat with i from 1 to winCount
              set w to window i
              set pos to position of w
              set sz to size of w
              set ttl to name of w
              set mini to miniaturized of w
              set result to result & {ttl & "|" & i & "|" & (item 1 of pos) & "|" & (item 2 of pos) & "|" & (item 1 of sz) & "|" & (item 2 of sz) & "|" & mini & "||"}
            end repeat
            return result as text
          end tell
        end tell`;
      const raw = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8', timeout: 8000 }).trim();
      if (!raw) return [];
      return raw.split('||').filter(Boolean).map(entry => {
        const p = entry.split('|');
        return {
          title: p[0] ?? '',
          index: parseInt(p[1] ?? '0'),
          position: [parseInt(p[2] ?? '0'), parseInt(p[3] ?? '0')] as [number, number],
          size: [parseInt(p[4] ?? '0'), parseInt(p[5] ?? '0')] as [number, number],
          minimized: (p[6] ?? '').trim() === 'true',
        };
      });
    } catch {
      return [];
    }
  }

  // ── OCR with Confidence ────────────────────────────────────

  /** Get OCR text with confidence scores, optionally for a screen region. */
  async getTextWithConfidence(region?: { x: number; y: number; width: number; height: number }): Promise<Array<{ text: string; confidence: number; bounds: { x: number; y: number; width: number; height: number } }>> {
    const { execSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const tmpImg = path.join(os.tmpdir(), `omni_ocr_${Date.now()}.png`);
    try {
      // Capture the region or full screen
      if (region) {
        execSync(`screencapture -x -R${region.x},${region.y},${region.width},${region.height} "${tmpImg}"`, { timeout: 5000 });
      } else {
        execSync(`screencapture -x "${tmpImg}"`, { timeout: 5000 });
      }

      // Try Vision framework via Swift one-liner
      const swiftScript = `
import Vision
import AppKit
let url = URL(fileURLWithPath: "${tmpImg}")
guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let req = VNRecognizeTextRequest { req, _ in
  guard let obs = req.results as? [VNRecognizedTextObservation] else { return }
  for o in obs {
    guard let top = o.topCandidates(1).first else { continue }
    let b = o.boundingBox
    let imgW = CGFloat(cgImage.width)
    let imgH = CGFloat(cgImage.height)
    let x = Int(b.minX * imgW)
    let y = Int((1 - b.maxY) * imgH)
    let w = Int(b.width * imgW)
    let h = Int(b.height * imgH)
    print("\\(top.string)|\\(top.confidence)|\\(x)|\\(y)|\\(w)|\\(h)")
  }
}
req.recognitionLevel = .accurate
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([req])
`;
      const swiftFile = path.join(os.tmpdir(), `omni_vision_${Date.now()}.swift`);
      const fs = await import('fs');
      fs.writeFileSync(swiftFile, swiftScript);
      try {
        const raw = execSync(`swift "${swiftFile}" 2>/dev/null`, { encoding: 'utf-8', timeout: 15000 }).trim();
        fs.unlinkSync(swiftFile);
        if (tmpImg) { try { fs.unlinkSync(tmpImg); } catch { /* ignore */ } }
        if (!raw) return [];
        const offsetX = region?.x ?? 0;
        const offsetY = region?.y ?? 0;
        return raw.split('\n').filter(Boolean).map(line => {
          const [text, conf, bx, by, bw, bh] = line.split('|');
          return {
            text: text ?? '',
            confidence: parseFloat(conf ?? '1'),
            bounds: { x: offsetX + parseInt(bx ?? '0'), y: offsetY + parseInt(by ?? '0'), width: parseInt(bw ?? '0'), height: parseInt(bh ?? '0') },
          };
        });
      } catch {
        fs.unlinkSync(swiftFile);
      }
    } catch {
      // ignore
    }
    // Fallback: wrap captureScreen + bridge OCR with confidence 1.0
    try {
      const capture = region
        ? await this.captureRegion(region.x, region.y, region.width, region.height)
        : await this.captureScreen();
      const text: string = (bridge as unknown as Record<string, (b: Buffer, w: number, h: number) => string>).performOCR?.(capture.data, capture.width, capture.height) ?? '';
      if (!text) return [];
      return [{ text, confidence: 1.0, bounds: { x: region?.x ?? 0, y: region?.y ?? 0, width: capture.width, height: capture.height } }];
    } catch {
      return [];
    }
  }

  /** Find all instances of searchText on screen, returning locations with confidence. */
  async findTextOnScreen(searchText: string): Promise<Array<{ text: string; confidence: number; bounds: { x: number; y: number; width: number; height: number } }>> {
    const all = await this.getTextWithConfidence();
    const lower = searchText.toLowerCase();
    return all.filter(r => r.text.toLowerCase().includes(lower));
  }

  // ── Drag and Drop ──────────────────────────────────────────

  /** Drag from one point to another with optional duration for smooth movement. */
  async dragAndDrop(fromX: number, fromY: number, toX: number, toY: number, durationMs: number = 300): Promise<void> {
    // Use existing bridge drag if no custom duration needed
    if (durationMs <= 0) {
      bridge.drag(fromX, fromY, toX, toY);
      return;
    }
    // Native bridge exposes drag as a full gesture; use it for reliability.
    await this.moveMouseSmooth(fromX, fromY, fromX, fromY, 1);
    bridge.drag(fromX, fromY, toX, toY);
  }

  /** Drag a file from the filesystem to screen coordinates using Finder. */
  async dragFile(filePath: string, toX: number, toY: number): Promise<void> {
    const { execSync } = await import('child_process');
    // Reveal file in Finder, then drag to target via cliclick if available; else AppleScript
    const escaped = filePath.replace(/"/g, '\\"');
    try {
      // Try cliclick (brew install cliclick) for precise drag
      execSync(`which cliclick`, { timeout: 2000 });
      execSync(`osascript -e 'tell application "Finder" to reveal POSIX file "${escaped}"'`, { timeout: 5000 });
      execSync(`osascript -e 'tell application "Finder" to activate'`, { timeout: 3000 });
      await sleep(500);
      execSync(`cliclick dd:. du:${toX},${toY}`, { timeout: 10000 });
    } catch {
      // Fallback: AppleScript drag via Finder
      const script = `
        tell application "Finder"
          set theFile to POSIX file "${escaped}" as alias
          reveal theFile
          activate
        end tell
        tell application "System Events"
          set src to {position of front window of application process "Finder"}
        end tell`;
      try {
        execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 8000 });
      } catch {
        // Best-effort: use bridge drag from file icon center approximation
        bridge.drag(200, 200, toX, toY);
      }
    }
  }

  // ── Screenshot Annotation ──────────────────────────────────

  /** Capture a rectangular region to a file, returning the output path. */
  async captureRegionToFile(x: number, y: number, width: number, height: number, outputPath: string): Promise<string> {
    const { execSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const finalPath = outputPath || path.join(os.tmpdir(), `omni_region_${Date.now()}.png`);
    execSync(`screencapture -x -R${x},${y},${width},${height} "${finalPath}"`, { timeout: 8000 });
    return finalPath;
  }

  /** Capture a specific app window to a file (frontmost app if omitted). Returns output path. */
  async captureWindowToFile(appName?: string, outputPath?: string): Promise<string> {
    const { execSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const finalPath = outputPath || path.join(os.tmpdir(), `omni_window_${Date.now()}.png`);

    try {
      // Get window ID via CGWindowListCopyWindowInfo using osascript/swift
      const processName = appName ?? (() => {
        try {
          return execSync(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`, { encoding: 'utf-8', timeout: 3000 }).trim();
        } catch { return null; }
      })();

      if (processName) {
        const swiftSnip = `import AppKit; let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String:Any]]; for w in list { if let owner = w[kCGWindowOwnerName as String] as? String, owner == "${processName}", let wid = w[kCGWindowNumber as String] as? Int { print(wid); break } }`;
        try {
          const wid = execSync(`swift -e '${swiftSnip.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8', timeout: 8000 }).trim();
          if (wid) {
            execSync(`screencapture -x -l${wid} "${finalPath}"`, { timeout: 8000 });
            return finalPath;
          }
        } catch { /* fall through */ }
      }
    } catch { /* fall through */ }

    // Fallback: capture the focused window with -w flag
    execSync(`screencapture -x -w "${finalPath}"`, { timeout: 10000 });
    return finalPath;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cropBufferRegion(
  src: Buffer,
  srcWidth: number,
  srcHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  srcBytesPerRow?: number
): { width: number; height: number; data: Buffer } {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(srcWidth, startX + Math.max(1, Math.floor(width)));
  const endY = Math.min(srcHeight, startY + Math.max(1, Math.floor(height)));

  const outWidth = Math.max(1, endX - startX);
  const outHeight = Math.max(1, endY - startY);

  const bytesPerPixel = 4;
  const inStride = srcBytesPerRow ?? srcWidth * bytesPerPixel;
  const outStride = outWidth * bytesPerPixel;
  const out = Buffer.alloc(outStride * outHeight);

  for (let row = 0; row < outHeight; row++) {
    const inOffset = (startY + row) * inStride + startX * bytesPerPixel;
    const outOffset = row * outStride;
    src.copy(out, outOffset, inOffset, inOffset + outStride);
  }

  return { width: outWidth, height: outHeight, data: out };
}

export interface ScreenCapture {
  width: number;
  height: number;
  data: Buffer;
  timestampMs: number;
  captureMethod?: string;
  bytesPerRow?: number;
  pixelFormat?: string;
}

export interface WindowInfo {
  id: number;
  title: string;
  owner: string;
  bounds: { x: number; y: number; width: number; height: number };
  isOnScreen: boolean;
}

export interface DetectedElement {
  id: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  text?: string;
  confidence: number;
  detectionMethod?: string;
}
