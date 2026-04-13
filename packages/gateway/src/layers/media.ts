/**
 * Media Layer — macOS media playback, audio routing, and video control.
 *
 * Implements UC7: Media Control.
 *   UC7.1 Music Playback Control   UC7.2 Volume & Audio Routing
 *   UC7.3 Playlist Management      UC7.4 AirPlay & Streaming
 *   UC7.5 Video Control
 *
 * macOS-first; uses AppleScript (osascript), system_profiler, and
 * optional third-party helpers (SwitchAudioSource).
 * Every method has try/catch with safe fallback returns.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

import type { DeepLayer } from "./deep.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// UC7.1 — Music Playback Control
// ---------------------------------------------------------------------------

export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  /** Track duration in seconds. */
  duration: number;
  /** Current playback position in seconds. */
  position: number;
  isPlaying: boolean;
  /** The app currently playing: 'music' | 'spotify' | null */
  app: "music" | "spotify" | null;
}

export interface QueueItem {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// UC7.2 — Volume & Audio Routing
// ---------------------------------------------------------------------------

export interface AudioOutputDevice {
  name: string;
  isDefault: boolean;
  type: string;
}

// ---------------------------------------------------------------------------
// UC7.3 — Playlist Management
// ---------------------------------------------------------------------------

export interface Playlist {
  name: string;
  trackCount: number;
  duration: number;
  app: "music" | "spotify";
}

export interface SearchResult {
  title: string;
  artist: string;
  album: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// UC7.4 — AirPlay & Streaming
// ---------------------------------------------------------------------------

export interface AirPlayDevice {
  name: string;
  active: boolean;
  kind: string;
}

// ---------------------------------------------------------------------------
// UC7.5 — Video Control
// ---------------------------------------------------------------------------

export type VideoApp = "quicktime" | "vlc" | "iina";

export interface VideoPlayerInfo {
  app: VideoApp;
  name: string;
  running: boolean;
}

export interface VideoInfo {
  title: string;
  duration: number;
  position: number;
  isPlaying: boolean;
  app: VideoApp | null;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class MediaLayer {
  constructor(private readonly deep: DeepLayer) {}

  // ── helpers ─────────────────────────────────────────────────────────────

  private get isMac(): boolean {
    return platform() === "darwin";
  }

  /** Run a shell command asynchronously; returns stdout on success or "" on failure. */
  private async run(cmd: string, timeoutMs = 15_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }

  /** Run an AppleScript snippet and return trimmed stdout. */
  private async osascript(script: string): Promise<string> {
    return this.run(`osascript -e ${JSON.stringify(script)}`);
  }

  /**
   * Detect which music app is currently running.
   * Returns 'music' | 'spotify' | null.
   */
  private async detectMusicApp(): Promise<"music" | "spotify" | null> {
    const musicRunning = await this.run(
      `pgrep -ix "Music" 2>/dev/null | head -1`
    );
    if (musicRunning) return "music";

    const spotifyRunning = await this.run(
      `pgrep -ix "Spotify" 2>/dev/null | head -1`
    );
    if (spotifyRunning) return "spotify";

    return null;
  }

  /**
   * Resolve the target app string for AppleScript.
   * Falls back to auto-detect when no explicit app is given.
   */
  private async resolveApp(
    app?: "music" | "spotify"
  ): Promise<{ appName: string; appKey: "music" | "spotify" } | null> {
    const resolved = app ?? (await this.detectMusicApp());
    if (!resolved) return null;
    return {
      appName: resolved === "music" ? "Music" : "Spotify",
      appKey: resolved,
    };
  }

  /** Detect which video player app is frontmost/running. */
  private async detectVideoApp(): Promise<VideoApp | null> {
    const checks: Array<{ key: VideoApp; process: string }> = [
      { key: "quicktime", process: "QuickTime Player" },
      { key: "vlc", process: "VLC" },
      { key: "iina", process: "IINA" },
    ];
    for (const { key, process: proc } of checks) {
      const pid = await this.run(`pgrep -ix ${JSON.stringify(proc)} 2>/dev/null | head -1`);
      if (pid) return key;
    }
    return null;
  }

  // =========================================================================
  // UC7.1 — Music Playback Control
  // =========================================================================

  /**
   * Play / resume in the frontmost music app (Apple Music or Spotify).
   */
  async play(): Promise<void> {
    const resolved = await this.resolveApp();
    if (!resolved) return;
    await this.osascript(`tell application "${resolved.appName}" to play`);
  }

  /**
   * Pause playback in the frontmost music app.
   */
  async pause(): Promise<void> {
    const resolved = await this.resolveApp();
    if (!resolved) return;
    await this.osascript(`tell application "${resolved.appName}" to pause`);
  }

  /**
   * Toggle play/pause in the frontmost music app.
   */
  async togglePlayPause(): Promise<void> {
    const resolved = await this.resolveApp();
    if (!resolved) return;
    if (resolved.appKey === "music") {
      await this.osascript(
        `tell application "Music" to playpause`
      );
    } else {
      await this.osascript(
        `tell application "Spotify" to playpause`
      );
    }
  }

  /**
   * Skip to the next track.
   */
  async nextTrack(): Promise<void> {
    const resolved = await this.resolveApp();
    if (!resolved) return;
    await this.osascript(
      `tell application "${resolved.appName}" to next track`
    );
  }

  /**
   * Go to the previous track.
   */
  async previousTrack(): Promise<void> {
    const resolved = await this.resolveApp();
    if (!resolved) return;
    await this.osascript(
      `tell application "${resolved.appName}" to previous track`
    );
  }

  /**
   * Get info about the currently playing track.
   * Returns null when no music app is running or nothing is loaded.
   */
  async getCurrentTrack(): Promise<TrackInfo | null> {
    const resolved = await this.resolveApp();
    if (!resolved) return null;

    try {
      if (resolved.appKey === "music") {
        const script = `
tell application "Music"
  if player state is stopped then return "STOPPED"
  set t to current track
  set pos to player position
  set st to player state
  return (name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (duration of t) & "|||" & pos & "|||" & st
end tell`;
        const raw = await this.osascript(script);
        if (!raw || raw === "STOPPED") return null;
        const [title, artist, album, dur, pos, state] = raw.split("|||");
        return {
          title: title?.trim() ?? "",
          artist: artist?.trim() ?? "",
          album: album?.trim() ?? "",
          duration: parseFloat(dur ?? "0") || 0,
          position: parseFloat(pos ?? "0") || 0,
          isPlaying: state?.trim() === "playing",
          app: "music",
        };
      } else {
        const script = `
tell application "Spotify"
  if player state is stopped then return "STOPPED"
  set t to current track
  set pos to player position
  set st to player state
  return (name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (duration of t) & "|||" & pos & "|||" & st
end tell`;
        const raw = await this.osascript(script);
        if (!raw || raw === "STOPPED") return null;
        const [title, artist, album, dur, pos, state] = raw.split("|||");
        return {
          title: title?.trim() ?? "",
          artist: artist?.trim() ?? "",
          album: album?.trim() ?? "",
          // Spotify returns duration in milliseconds
          duration: (parseFloat(dur ?? "0") || 0) / 1000,
          position: parseFloat(pos ?? "0") || 0,
          isPlaying: state?.trim() === "playing",
          app: "spotify",
        };
      }
    } catch {
      return null;
    }
  }

  /**
   * Seek to a specific position (in seconds) in the current track.
   */
  async setPosition(seconds: number): Promise<void> {
    const resolved = await this.resolveApp();
    if (!resolved) return;
    const safe = Math.max(0, seconds);
    if (resolved.appKey === "music") {
      await this.osascript(
        `tell application "Music" to set player position to ${safe}`
      );
    } else {
      await this.osascript(
        `tell application "Spotify" to set player position to ${safe}`
      );
    }
  }

  /**
   * Get the upcoming track queue (Apple Music only).
   * Returns an empty array for Spotify (not supported via AppleScript).
   */
  async getQueue(limit = 10): Promise<QueueItem[]> {
    const resolved = await this.resolveApp();
    if (!resolved || resolved.appKey !== "music") return [];

    try {
      const script = `
tell application "Music"
  set q to {}
  set upNext to tracks of current playlist
  set curIdx to index of current track
  set endIdx to curIdx + ${limit}
  if endIdx > (count of upNext) then set endIdx to count of upNext
  repeat with i from (curIdx + 1) to endIdx
    set t to item i of upNext
    set q to q & {(name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (duration of t) & "---"}
  end repeat
  return q as string
end tell`;
      const raw = await this.osascript(script);
      if (!raw) return [];

      return raw
        .split("---")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
          const [title, artist, album, dur] = entry.split("|||");
          return {
            title: title?.trim() ?? "",
            artist: artist?.trim() ?? "",
            album: album?.trim() ?? "",
            duration: parseFloat(dur ?? "0") || 0,
          };
        });
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC7.2 — Volume & Audio Routing
  // =========================================================================

  /**
   * Get the app-specific playback volume (0-100).
   * Falls back to auto-detect when no explicit app is given.
   */
  async getPlayerVolume(app?: "music" | "spotify"): Promise<number> {
    const resolved = await this.resolveApp(app);
    if (!resolved) return 0;

    try {
      const script =
        resolved.appKey === "music"
          ? `tell application "Music" to sound volume`
          : `tell application "Spotify" to sound volume`;
      const raw = await this.osascript(script);
      return parseInt(raw, 10) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Set the app-specific playback volume (0-100).
   * Falls back to auto-detect when no explicit app is given.
   */
  async setPlayerVolume(level: number, app?: "music" | "spotify"): Promise<void> {
    const resolved = await this.resolveApp(app);
    if (!resolved) return;
    const safe = Math.min(100, Math.max(0, Math.round(level)));

    if (resolved.appKey === "music") {
      await this.osascript(
        `tell application "Music" to set sound volume to ${safe}`
      );
    } else {
      await this.osascript(
        `tell application "Spotify" to set sound volume to ${safe}`
      );
    }
  }

  /**
   * Get the current system audio output device via system_profiler.
   */
  async getAudioOutput(): Promise<AudioOutputDevice | null> {
    try {
      const raw = await this.run(
        "system_profiler SPAudioDataType -json 2>/dev/null",
        20_000
      );
      if (!raw) return null;

      const data = JSON.parse(raw) as Record<string, unknown>;
      const audioItems = (data["SPAudioDataType"] as unknown[]) ?? [];

      for (const item of audioItems) {
        const rec = item as Record<string, unknown>;
        const name = (rec["_name"] as string) ?? "";
        if (!name) continue;
        const defaultOutput =
          (rec["coreaudio_default_audio_output_device"] as string) ?? "";
        if (defaultOutput === "spaudio_yes") {
          return { name, isDefault: true, type: "output" };
        }
      }

      // Fallback: return the first output device found
      for (const item of audioItems) {
        const rec = item as Record<string, unknown>;
        const name = (rec["_name"] as string) ?? "";
        if (name) {
          return { name, isDefault: false, type: "output" };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Switch the system audio output device by name.
   * Attempts to use the `SwitchAudioSource` CLI tool (brew install switchaudio-osx)
   * and falls back to an AppleScript approach via System Preferences.
   */
  async setAudioOutput(deviceName: string): Promise<void> {
    // Try SwitchAudioSource (preferred)
    const result = await this.run(
      `SwitchAudioSource -s ${JSON.stringify(deviceName)} 2>/dev/null`
    );
    if (result) return;

    // Fallback: open Sound System Preferences (informational only)
    await this.run(
      `open "x-apple.systempreferences:com.apple.preference.sound"`
    );
  }

  // =========================================================================
  // UC7.3 — Playlist Management
  // =========================================================================

  /**
   * List all playlists in the specified app (or auto-detected app).
   */
  async getPlaylists(app?: "music" | "spotify"): Promise<Playlist[]> {
    const resolved = await this.resolveApp(app);
    if (!resolved) return [];

    try {
      if (resolved.appKey === "music") {
        const script = `
tell application "Music"
  set result to ""
  repeat with pl in playlists
    set result to result & (name of pl) & "|||" & (count of tracks of pl) & "|||" & (duration of pl) & "---"
  end repeat
  return result
end tell`;
        const raw = await this.osascript(script);
        if (!raw) return [];

        return raw
          .split("---")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((entry) => {
            const [name, count, dur] = entry.split("|||");
            return {
              name: name?.trim() ?? "",
              trackCount: parseInt(count ?? "0", 10) || 0,
              duration: parseFloat(dur ?? "0") || 0,
              app: "music" as const,
            };
          });
      } else {
        // Spotify has limited AppleScript support for playlists
        const script = `
tell application "Spotify"
  set result to ""
  repeat with pl in playlists
    set result to result & (name of pl) & "|||0|||0---"
  end repeat
  return result
end tell`;
        const raw = await this.osascript(script);
        if (!raw) return [];

        return raw
          .split("---")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((entry) => {
            const [name] = entry.split("|||");
            return {
              name: name?.trim() ?? "",
              trackCount: 0,
              duration: 0,
              app: "spotify" as const,
            };
          });
      }
    } catch {
      return [];
    }
  }

  /**
   * Play a playlist by name in the specified (or auto-detected) app.
   */
  async playPlaylist(
    name: string,
    app?: "music" | "spotify"
  ): Promise<void> {
    const resolved = await this.resolveApp(app);
    if (!resolved) return;

    if (resolved.appKey === "music") {
      await this.osascript(
        `tell application "Music" to play playlist ${JSON.stringify(name)}`
      );
    } else {
      await this.osascript(
        `tell application "Spotify" to play playlist ${JSON.stringify(name)}`
      );
    }
  }

  /**
   * Add the current (or named) track to a playlist in Apple Music.
   * Spotify does not support adding tracks via AppleScript.
   */
  async addToPlaylist(
    trackName: string,
    playlistName: string
  ): Promise<void> {
    const script = `
tell application "Music"
  set targetPlaylist to playlist ${JSON.stringify(playlistName)}
  if ${JSON.stringify(trackName)} is "" then
    set t to current track
  else
    set results to (search playlist "Library" for ${JSON.stringify(trackName)})
    if results is {} then error "Track not found"
    set t to first item of results
  end if
  duplicate t to targetPlaylist
end tell`;
    await this.osascript(script);
  }

  /**
   * Create a new empty playlist in the specified (or auto-detected) app.
   * Apple Music only; Spotify does not support this via AppleScript.
   */
  async createPlaylist(
    name: string,
    app?: "music" | "spotify"
  ): Promise<void> {
    const resolved = await this.resolveApp(app);
    if (!resolved) return;

    if (resolved.appKey === "music") {
      await this.osascript(
        `tell application "Music" to make new playlist with properties {name: ${JSON.stringify(name)}}`
      );
    }
    // Spotify does not support creating playlists via AppleScript
  }

  /**
   * Search the library for tracks matching a query.
   */
  async searchTracks(
    query: string,
    app?: "music" | "spotify"
  ): Promise<SearchResult[]> {
    const resolved = await this.resolveApp(app);
    if (!resolved) return [];

    try {
      if (resolved.appKey === "music") {
        const script = `
tell application "Music"
  set results to (search playlist "Library" for ${JSON.stringify(query)})
  set output to ""
  set n to count of results
  if n > 20 then set n to 20
  repeat with i from 1 to n
    set t to item i of results
    set output to output & (name of t) & "|||" & (artist of t) & "|||" & (album of t) & "|||" & (duration of t) & "---"
  end repeat
  return output
end tell`;
        const raw = await this.osascript(script);
        if (!raw) return [];

        return raw
          .split("---")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((entry) => {
            const [title, artist, album, dur] = entry.split("|||");
            return {
              title: title?.trim() ?? "",
              artist: artist?.trim() ?? "",
              album: album?.trim() ?? "",
              duration: parseFloat(dur ?? "0") || 0,
            };
          });
      } else {
        // Spotify: search is not available via AppleScript; return empty
        return [];
      }
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC7.4 — AirPlay & Streaming
  // =========================================================================

  /**
   * List available AirPlay devices via AppleScript (Apple Music).
   */
  async getAirPlayDevices(): Promise<AirPlayDevice[]> {
    try {
      const script = `
tell application "Music"
  set output to ""
  repeat with d in AirPlay devices
    set output to output & (name of d) & "|||" & (selected of d) & "|||" & (kind of d) & "---"
  end repeat
  return output
end tell`;
      const raw = await this.osascript(script);
      if (!raw) return [];

      return raw
        .split("---")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
          const [name, active, kind] = entry.split("|||");
          return {
            name: name?.trim() ?? "",
            active: active?.trim() === "true",
            kind: kind?.trim() ?? "unknown",
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Route audio output to a specific AirPlay device by name.
   */
  async setAirPlayDevice(deviceName: string): Promise<void> {
    const script = `
tell application "Music"
  set targetDevice to first AirPlay device whose name is ${JSON.stringify(deviceName)}
  set selected of targetDevice to true
end tell`;
    await this.osascript(script);
  }

  /**
   * Check if Apple Music is currently streaming to an AirPlay device.
   */
  async isAirPlaying(): Promise<boolean> {
    try {
      const script = `
tell application "Music"
  repeat with d in AirPlay devices
    if selected of d is true and name of d is not "My Computer" then
      return "true"
    end if
  end repeat
  return "false"
end tell`;
      const raw = await this.osascript(script);
      return raw.trim() === "true";
    } catch {
      return false;
    }
  }

  /**
   * Stop AirPlay streaming and route audio back to the local device.
   */
  async stopAirPlay(): Promise<void> {
    const script = `
tell application "Music"
  repeat with d in AirPlay devices
    if name of d is "My Computer" then
      set selected of d to true
    else
      set selected of d to false
    end if
  end repeat
end tell`;
    await this.osascript(script);
  }

  // =========================================================================
  // UC7.5 — Video Control
  // =========================================================================

  /**
   * Detect which video player apps (QuickTime, VLC, IINA) are currently running.
   */
  async getVideoPlayers(): Promise<VideoPlayerInfo[]> {
    const apps: Array<{ key: VideoApp; name: string; process: string }> = [
      { key: "quicktime", name: "QuickTime Player", process: "QuickTime Player" },
      { key: "vlc", name: "VLC", process: "VLC" },
      { key: "iina", name: "IINA", process: "IINA" },
    ];

    const results: VideoPlayerInfo[] = [];
    for (const { key, name, process: proc } of apps) {
      const pid = await this.run(
        `pgrep -ix ${JSON.stringify(proc)} 2>/dev/null | head -1`
      );
      results.push({ app: key, name, running: !!pid });
    }
    return results;
  }

  /**
   * Control the frontmost video player.
   * Supports QuickTime Player, VLC, and IINA.
   */
  async controlVideo(
    action: "play" | "pause" | "stop" | "fullscreen" | "exitFullscreen"
  ): Promise<void> {
    const app = await this.detectVideoApp();
    if (!app) return;

    if (app === "quicktime") {
      const actionMap: Record<string, string> = {
        play: `tell application "QuickTime Player" to play front document`,
        pause: `tell application "QuickTime Player" to pause front document`,
        stop: `tell application "QuickTime Player" to stop front document`,
        fullscreen: `tell application "QuickTime Player"
  activate
  tell front document to present
end tell`,
        exitFullscreen: `tell application "QuickTime Player"
  activate
  tell front document to stop presenting
end tell`,
      };
      const script = actionMap[action];
      if (script) await this.osascript(script);
    } else if (app === "vlc") {
      const actionMap: Record<string, string> = {
        play: `tell application "VLC" to play`,
        pause: `tell application "VLC" to pause`,
        stop: `tell application "VLC" to stop`,
        fullscreen: `tell application "VLC" to fullscreen`,
        exitFullscreen: `tell application "VLC" to fullscreen`,
      };
      const script = actionMap[action];
      if (script) await this.osascript(script);
    } else if (app === "iina") {
      // IINA uses menu-based AppleScript control
      const menuMap: Record<string, string> = {
        play: `tell application "IINA" to play`,
        pause: `tell application "IINA" to pause`,
        stop: `tell application "IINA" to stop`,
        fullscreen: `
tell application "System Events"
  tell process "IINA"
    keystroke "f" using {command down}
  end tell
end tell`,
        exitFullscreen: `
tell application "System Events"
  tell process "IINA"
    key code 53
  end tell
end tell`,
      };
      const script = menuMap[action];
      if (script) await this.osascript(script);
    }
  }

  /**
   * Get info about the currently playing video.
   * Returns null if no video app is running or no document is open.
   */
  async getVideoInfo(): Promise<VideoInfo | null> {
    const app = await this.detectVideoApp();
    if (!app) return null;

    try {
      if (app === "quicktime") {
        const script = `
tell application "QuickTime Player"
  if (count of documents) is 0 then return "NONE"
  set d to front document
  set st to playing of d
  return (name of d) & "|||" & (duration of d) & "|||" & (current time of d) & "|||" & st
end tell`;
        const raw = await this.osascript(script);
        if (!raw || raw === "NONE") return null;
        const [title, dur, pos, playing] = raw.split("|||");
        return {
          title: title?.trim() ?? "",
          duration: parseFloat(dur ?? "0") || 0,
          position: parseFloat(pos ?? "0") || 0,
          isPlaying: playing?.trim() === "true",
          app: "quicktime",
        };
      } else if (app === "vlc") {
        const script = `
tell application "VLC"
  if playing is false then return "NONE"
  return (name of current item) & "|||" & (duration) & "|||" & (time) & "|||true"
end tell`;
        const raw = await this.osascript(script);
        if (!raw || raw === "NONE") return null;
        const [title, dur, pos] = raw.split("|||");
        return {
          title: title?.trim() ?? "",
          duration: parseFloat(dur ?? "0") || 0,
          position: parseFloat(pos ?? "0") || 0,
          isPlaying: true,
          app: "vlc",
        };
      } else if (app === "iina") {
        const script = `
tell application "IINA"
  if (count of windows) is 0 then return "NONE"
  return (name of front window) & "|||0|||0|||true"
end tell`;
        const raw = await this.osascript(script);
        if (!raw || raw === "NONE") return null;
        const [title] = raw.split("|||");
        return {
          title: title?.trim() ?? "",
          duration: 0,
          position: 0,
          isPlaying: true,
          app: "iina",
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Seek to a specific position (in seconds) in the frontmost video player.
   */
  async setVideoPosition(seconds: number): Promise<void> {
    const app = await this.detectVideoApp();
    if (!app) return;
    const safe = Math.max(0, seconds);

    if (app === "quicktime") {
      await this.osascript(
        `tell application "QuickTime Player" to set current time of front document to ${safe}`
      );
    } else if (app === "vlc") {
      await this.osascript(
        `tell application "VLC" to set time to ${safe}`
      );
    } else if (app === "iina") {
      // IINA does not expose a direct position property via standard AppleScript;
      // use keystroke simulation as a best-effort fallback.
      await this.run(
        `osascript -e 'tell application "IINA" to activate'`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Podcast Control
  // ---------------------------------------------------------------------------

  /** Get podcast episodes from Apple Podcasts. */
  async getPodcastEpisodes(
    showName?: string,
    limit = 20,
  ): Promise<
    Array<{
      title: string;
      show: string;
      duration: number;
      publishDate: string;
      played: boolean;
    }>
  > {
    if (!this.isMac) return [];
    try {
      const filter = showName
        ? ` whose podcast name is "${showName.replace(/"/g, '\\"')}"`
        : "";
      const raw = await this.osascript(
        `tell application "Podcasts"
          set epList to every episode${filter}
          set results to {}
          repeat with i from 1 to (count epList)
            if i > ${limit} then exit repeat
            set ep to item i of epList
            set end of results to (name of ep) & "|||" & (podcast name of ep) & "|||" & (duration of ep as string) & "|||" & (release date of ep as string) & "|||" & (played status of ep as string)
          end repeat
          return results as string
        end tell`,
      );
      if (!raw) return [];
      return raw
        .split(", ")
        .map((line) => {
          const [title, show, duration, publishDate, played] =
            line.split("|||");
          return {
            title: title?.trim() ?? "",
            show: show?.trim() ?? "",
            duration: Number.parseInt(duration ?? "0", 10),
            publishDate: publishDate?.trim() ?? "",
            played: played?.trim() === "true",
          };
        })
        .filter((ep) => ep.title);
    } catch {
      return [];
    }
  }

  /** Play a podcast episode by title, or resume current if no title given. */
  async playPodcast(episodeTitle?: string): Promise<void> {
    if (!this.isMac) return;
    if (!episodeTitle) {
      await this.osascript(`tell application "Podcasts" to resume`);
      return;
    }
    const safe = episodeTitle.replace(/"/g, '\\"');
    await this.osascript(
      `tell application "Podcasts"
        set ep to first episode whose name contains "${safe}"
        play ep
      end tell`,
    );
  }

  /** Get subscribed podcast shows. */
  async getPodcastSubscriptions(): Promise<
    Array<{ name: string; author: string; episodeCount: number }>
  > {
    if (!this.isMac) return [];
    try {
      const raw = await this.osascript(
        `tell application "Podcasts"
          set podList to every podcast
          set results to {}
          repeat with p in podList
            set end of results to (name of p) & "|||" & (artist of p) & "|||" & ((count of episodes of p) as string)
          end repeat
          return results as string
        end tell`,
      );
      if (!raw) return [];
      return raw
        .split(", ")
        .map((line) => {
          const [name, author, episodeCount] = line.split("|||");
          return {
            name: name?.trim() ?? "",
            author: author?.trim() ?? "",
            episodeCount: Number.parseInt(episodeCount ?? "0", 10),
          };
        })
        .filter((p) => p.name);
    } catch {
      return [];
    }
  }

  /** Get info about the currently playing podcast episode. */
  async getPodcastPlaybackInfo(): Promise<{
    title: string;
    show: string;
    position: number;
    duration: number;
    isPlaying: boolean;
  } | null> {
    if (!this.isMac) return null;
    try {
      const raw = await this.osascript(
        `tell application "Podcasts"
          set ep to current episode
          if ep is missing value then return ""
          set pos to player position
          set dur to duration of ep
          set playing to (player state is playing)
          return (name of ep) & "|||" & (podcast name of ep) & "|||" & (pos as string) & "|||" & (dur as string) & "|||" & (playing as string)
        end tell`,
      );
      if (!raw) return null;
      const [title, show, position, duration, isPlaying] = raw.split("|||");
      return {
        title: title?.trim() ?? "",
        show: show?.trim() ?? "",
        position: Number.parseFloat(position ?? "0"),
        duration: Number.parseInt(duration ?? "0", 10),
        isPlaying: isPlaying?.trim() === "true",
      };
    } catch {
      return null;
    }
  }

  /** Set podcast playback speed (0.5, 1.0, 1.5, 2.0). */
  async setPodcastSpeed(speed: number): Promise<void> {
    if (!this.isMac) return;
    const safe = Math.min(Math.max(speed, 0.5), 2.0);
    await this.osascript(
      `tell application "Podcasts" to set playback speed to ${safe}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Screen Recording
  // ---------------------------------------------------------------------------

  private _recordingPid: number | null = null;
  private _recordingOutputPath: string | null = null;
  private _recordingStartTime: number | null = null;

  /** Start a screen recording using macOS screencapture. */
  async startScreenRecording(options?: {
    region?: { x: number; y: number; width: number; height: number };
    audio?: boolean;
    outputPath?: string;
  }): Promise<{ pid: number; outputPath: string }> {
    if (!this.isMac) throw new Error("Screen recording requires macOS");
    if (this._recordingPid) throw new Error("Recording already in progress");

    const ts = Date.now();
    const outputPath =
      options?.outputPath ??
      `${process.env.HOME ?? "~"}/Desktop/recording_${ts}.mov`;
    this._recordingOutputPath = outputPath;
    this._recordingStartTime = ts;

    const audioFlag = options?.audio === false ? "" : "-a";
    const regionFlag = options?.region
      ? `-R ${options.region.x},${options.region.y},${options.region.width},${options.region.height}`
      : "";

    // screencapture -v records video; run in background and capture pid
    const cmd = `screencapture -v ${audioFlag} ${regionFlag} "${outputPath}" &`;
    await this.run(cmd, 2_000);

    // Find the PID of the newly spawned screencapture process
    const pidOut = await this.run(
      `pgrep -n screencapture 2>/dev/null || echo ""`,
    );
    const pid = Number.parseInt(pidOut.trim(), 10) || 0;
    this._recordingPid = pid || null;

    return { pid: pid || -1, outputPath };
  }

  /** Stop the current screen recording. */
  async stopScreenRecording(): Promise<{
    outputPath: string;
    duration: number;
  } | null> {
    if (!this.isMac) return null;
    const pid = this._recordingPid;
    const outputPath = this._recordingOutputPath;
    const startTime = this._recordingStartTime;

    if (!pid || !outputPath) {
      // Try to kill any running screencapture anyway
      await this.run("pkill -SIGINT screencapture 2>/dev/null || true");
      return null;
    }

    await this.run(`kill -SIGINT ${pid} 2>/dev/null || true`);
    this._recordingPid = null;
    this._recordingOutputPath = null;
    this._recordingStartTime = null;

    const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
    return { outputPath, duration };
  }

  /** Check if a screen recording is currently in progress. */
  async isRecording(): Promise<boolean> {
    if (!this.isMac) return false;
    const out = await this.run(
      "pgrep -x screencapture 2>/dev/null || echo ''",
    );
    return out.trim().length > 0;
  }

  /** List recent screen recordings from the Desktop or a specified directory. */
  async getRecordings(
    directory?: string,
    limit = 10,
  ): Promise<
    Array<{ path: string; size: number; duration?: number; created: string }>
  > {
    if (!this.isMac) return [];
    const dir = directory ?? `${process.env.HOME ?? "~"}/Desktop`;
    try {
      const raw = await this.run(
        `find "${dir}" -maxdepth 1 -name "*.mov" -o -name "*.mp4" | sort -r | head -${limit}`,
      );
      if (!raw.trim()) return [];
      const files = raw.trim().split("\n").filter(Boolean);
      const results: Array<{
        path: string;
        size: number;
        duration?: number;
        created: string;
      }> = [];
      for (const f of files) {
        const stat = await this.run(`stat -f "%z %SB" "${f}" 2>/dev/null || echo "0 unknown"`);
        const [sizeStr, ...dateParts] = stat.trim().split(" ");
        results.push({
          path: f,
          size: Number.parseInt(sizeStr ?? "0", 10),
          created: dateParts.join(" ") || "unknown",
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Media Key Simulation
  // ---------------------------------------------------------------------------

  /** Simulate a system media key press (works with any music/video app). */
  async simulateMediaKey(
    key:
      | "play_pause"
      | "next"
      | "previous"
      | "volume_up"
      | "volume_down"
      | "mute",
  ): Promise<void> {
    if (!this.isMac) return;
    // NX key codes: play=16, next=17, prev=18, vol_up=0, vol_down=1, mute=7
    const keyMap: Record<string, number> = {
      play_pause: 16,
      next: 17,
      previous: 18,
      volume_up: 0,
      volume_down: 1,
      mute: 7,
    };
    const keyCode = keyMap[key];
    if (keyCode === undefined) return;
    // Use JXA with ObjC bridge to post a media key event via CGEvent
    const jxa = `
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
function keyEvent(keyCode, down) {
  var src = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState);
  var ev = $.CGEventCreateKeyboardEvent(src, 0, down);
  $.CGEventSetIntegerValueField(ev, $.kCGKeyboardEventKeycode, 0);
  // Use NSEvent media key trick
  var ns = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
    $.NSSystemDefined, {x:0,y:0}, 0xa00, 0, 0, 0, $.NSAppKitDefined, 8, ${keyCode} << 16 | (down ? 0xa << 8 : 0xb << 8), 0
  );
  ns.CGEvent.post($.kCGHIDEventTap);
}
keyEvent(${keyCode}, true);
keyEvent(${keyCode}, false);
`;
    await this.run(`osascript -l JavaScript -e '${jxa.replace(/'/g, "'\"'\"'")}'`, 5_000);
  }

  /** Simulate a brightness key press. */
  async simulateBrightnessKey(direction: "up" | "down"): Promise<void> {
    if (!this.isMac) return;
    // NX_KEYTYPE_BRIGHTNESS_UP=21, NX_KEYTYPE_BRIGHTNESS_DOWN=22
    const keyCode = direction === "up" ? 21 : 22;
    const jxa = `
ObjC.import('AppKit');
function postMediaKey(keyCode, down) {
  var ns = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
    $.NSSystemDefined, {x:0,y:0}, 0xa00, 0, 0, 0, $.NSAppKitDefined, 8, keyCode << 16 | (down ? 0xa << 8 : 0xb << 8), 0
  );
  ns.CGEvent.post($.kCGHIDEventTap);
}
postMediaKey(${keyCode}, true);
postMediaKey(${keyCode}, false);
`;
    await this.run(`osascript -l JavaScript -e '${jxa.replace(/'/g, "'\"'\"'")}'`, 5_000);
  }

  /** Simulate a keyboard illumination (backlight) key press. */
  async simulateIlluminationKey(direction: "up" | "down"): Promise<void> {
    if (!this.isMac) return;
    // NX_KEYTYPE_ILLUMINATION_UP=131, NX_KEYTYPE_ILLUMINATION_DOWN=130
    const keyCode = direction === "up" ? 131 : 130;
    const jxa = `
ObjC.import('AppKit');
function postMediaKey(keyCode, down) {
  var ns = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2(
    $.NSSystemDefined, {x:0,y:0}, 0xa00, 0, 0, 0, $.NSAppKitDefined, 8, keyCode << 16 | (down ? 0xa << 8 : 0xb << 8), 0
  );
  ns.CGEvent.post($.kCGHIDEventTap);
}
postMediaKey(${keyCode}, true);
postMediaKey(${keyCode}, false);
`;
    await this.run(`osascript -l JavaScript -e '${jxa.replace(/'/g, "'\"'\"'")}'`, 5_000);
  }

  // ---------------------------------------------------------------------------
  // Audio Equalizer (Apple Music)
  // ---------------------------------------------------------------------------

  /** Get list of EQ preset names from Apple Music. */
  async getEQPresets(): Promise<string[]> {
    if (!this.isMac) return [];
    try {
      const raw = await this.osascript(
        `tell application "Music" to get name of every EQ preset`,
      );
      if (!raw) return [];
      return raw
        .split(", ")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Set the active EQ preset in Apple Music by name. */
  async setEQPreset(presetName: string): Promise<void> {
    if (!this.isMac) return;
    const safe = presetName.replace(/"/g, '\\"');
    await this.osascript(
      `tell application "Music" to set current EQ preset to EQ preset "${safe}"`,
    );
  }

  /** Check whether the equalizer is enabled in Apple Music. */
  async isEQEnabled(): Promise<boolean> {
    if (!this.isMac) return false;
    try {
      const raw = await this.osascript(
        `tell application "Music" to get EQ enabled`,
      );
      return raw.trim() === "true";
    } catch {
      return false;
    }
  }

  /** Enable or disable the equalizer in Apple Music. */
  async setEQEnabled(enabled: boolean): Promise<void> {
    if (!this.isMac) return;
    await this.osascript(
      `tell application "Music" to set EQ enabled to ${enabled}`,
    );
  }
}
