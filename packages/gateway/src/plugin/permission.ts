/**
 * Plugin permission system — guards API access per declared plugin permissions.
 */

import type { OmniStatePluginAPI, DeepLayerAccess, SurfaceLayerAccess, VisionAccess } from "./sdk.js";

export type PluginPermission =
  | "network:read" | "network:write"
  | "filesystem:read" | "filesystem:write"
  | "ui:read" | "ui:click" | "ui:type"
  | "system:read" | "system:write"
  | "clipboard:read" | "clipboard:write";

import type { PluginManifest } from "./registry.js";

export interface PluginManifestV2 extends PluginManifest {
  permissions: PluginPermission[];
  sandbox?: "worker_thread" | "none";
  timeout?: number;
}

export class PermissionDeniedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly permission: PluginPermission
  ) {
    super(`Plugin "${pluginId}" lacks permission: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export class PermissionGuard {
  constructor(
    private readonly pluginId: string,
    private readonly allowedPermissions: PluginPermission[]
  ) {}

  check(required: PluginPermission): void {
    if (!this.allowedPermissions.includes(required)) {
      throw new PermissionDeniedError(this.pluginId, required);
    }
  }

  checkAll(required: PluginPermission[]): void {
    for (const perm of required) {
      this.check(perm);
    }
  }

  wrapApi(api: OmniStatePluginAPI): OmniStatePluginAPI {
    const guard = this;

    const wrappedDeep: DeepLayerAccess = {
      exec: (command: string) => {
        guard.check("system:write");
        return api.deep.exec(command);
      },
      readFile: (path: string) => {
        guard.check("filesystem:read");
        return api.deep.readFile(path);
      },
      writeFile: (path: string, content: string) => {
        guard.check("filesystem:write");
        return api.deep.writeFile(path, content);
      },
      isProcessRunning: (name: string) => {
        guard.check("system:read");
        return api.deep.isProcessRunning(name);
      },
    };

    const wrappedSurface: SurfaceLayerAccess = {
      capture: () => {
        guard.check("ui:read");
        return api.surface.capture();
      },
      findElement: (screenshot, description) => {
        guard.check("ui:read");
        return api.surface.findElement(screenshot, description);
      },
      click: (target) => {
        guard.check("ui:click");
        return api.surface.click(target);
      },
      type: (text) => {
        guard.check("ui:type");
        return api.surface.type(text);
      },
      waitFor: (condition, options) => {
        guard.check("ui:read");
        return api.surface.waitFor(condition, options);
      },
      pressKey: (key) => {
        guard.check("ui:type");
        return api.surface.pressKey(key);
      },
    };

    const wrappedVision: VisionAccess = {
      verify: (screenshot, expected) => {
        guard.check("ui:read");
        return api.vision.verify(screenshot, expected);
      },
      detectElements: (screenshot, query) => {
        guard.check("ui:read");
        return api.vision.detectElements(screenshot, query);
      },
    };

    return {
      registerTool: api.registerTool.bind(api),
      registerHealthSensor: api.registerHealthSensor.bind(api),
      registerVerification: api.registerVerification.bind(api),
      deep: wrappedDeep,
      surface: wrappedSurface,
      vision: wrappedVision,
    };
  }
}
