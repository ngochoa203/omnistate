import { describe, expect, it } from "vitest";
import {
  inferDeviceTypeFromName,
  parseMacOsAudioCandidatesFromProfiler,
} from "../device-profiles.js";

describe("device-profiles helpers", () => {
  it("should infer known Apple audio device types from names", () => {
    expect(inferDeviceTypeFromName("AirPods Pro của Hoa")).toBe("airpods_pro");
    expect(inferDeviceTypeFromName("AirPods Max")).toBe("airpods_max");
    expect(inferDeviceTypeFromName("AirPods")).toBe("airpods");
    expect(inferDeviceTypeFromName("HomePod mini")).toBe("homepod");
    expect(inferDeviceTypeFromName("iPhone Microphone")).toBe("iphone");
    expect(inferDeviceTypeFromName("Built-in Output")).toBe("macos");
  });

  it("should return null for unrelated device names", () => {
    expect(inferDeviceTypeFromName("USB Audio Codec")).toBeNull();
    expect(inferDeviceTypeFromName("")).toBeNull();
  });

  it("should parse default macOS audio devices from system_profiler json", () => {
    const raw = JSON.stringify({
      SPAudioDataType: [
        {
          _name: "Built-in Output",
          coreaudio_default_audio_output_device: "spaudio_yes",
        },
        {
          _name: "AirPods Pro của Hoa",
          coreaudio_default_audio_input_device: "spaudio_yes",
        },
      ],
    });

    expect(parseMacOsAudioCandidatesFromProfiler(raw)).toEqual([
      {
        name: "Built-in Output",
        direction: "output",
        isDefault: true,
        source: "system_profiler",
      },
      {
        name: "AirPods Pro của Hoa",
        direction: "input",
        isDefault: true,
        source: "system_profiler",
      },
    ]);
  });
});
