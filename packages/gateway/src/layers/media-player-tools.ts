/**
 * Media Player Tools — Control various media applications.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Spotify Controls
// ------------------------------------------------------------------

export async function spotifyPlay(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to play'`);
    return true;
  } catch (e) {
    console.error("spotifyPlay failed:", e);
    return false;
  }
}

export async function spotifyPause(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to pause'`);
    return true;
  } catch (e) {
    console.error("spotifyPause failed:", e);
    return false;
  }
}

export async function spotifyToggle(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to playpause'`);
    return true;
  } catch (e) {
    console.error("spotifyToggle failed:", e);
    return false;
  }
}

export async function spotifyNext(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to next track'`);
    return true;
  } catch (e) {
    console.error("spotifyNext failed:", e);
    return false;
  }
}

export async function spotifyPrevious(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to previous track'`);
    return true;
  } catch (e) {
    console.error("spotifyPrevious failed:", e);
    return false;
  }
}

export async function spotifyVolume(level: number): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to set sound volume to ${level}'`);
    return true;
  } catch (e) {
    console.error("spotifyVolume failed:", e);
    return false;
  }
}

export async function spotifyGetCurrentTrack(): Promise<{ name: string; artist: string; album: string } | null> {
  try {
    const script = `osascript -e 'tell application "Spotify"
      set trackName to name of current track
      set artistName to artist of current track
      set albumName to album of current track
      return trackName & "|" & artistName & "|" & albumName
    end tell'`;
    
    const { stdout } = await execAsync(script, { encoding: "utf-8" });
    const parts = stdout.trim().split("|");
    
    return {
      name: parts[0] || "Unknown",
      artist: parts[1] || "Unknown",
      album: parts[2] || "Unknown"
    };
  } catch {
    return null;
  }
}

export async function spotifyPlayPlaylist(playlistUri: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Spotify" to play track "${playlistUri}"'`);
    return true;
  } catch (e) {
    console.error("spotifyPlayPlaylist failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// Apple Music Controls
// ------------------------------------------------------------------

export async function appleMusicPlay(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Music" to play'`);
    return true;
  } catch (e) {
    console.error("appleMusicPlay failed:", e);
    return false;
  }
}

export async function appleMusicPause(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Music" to pause'`);
    return true;
  } catch (e) {
    console.error("appleMusicPause failed:", e);
    return false;
  }
}

export async function appleMusicToggle(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Music" to playpause'`);
    return true;
  } catch (e) {
    console.error("appleMusicToggle failed:", e);
    return false;
  }
}

export async function appleMusicNext(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Music" to next track'`);
    return true;
  } catch (e) {
    console.error("appleMusicNext failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// YouTube Music
// ------------------------------------------------------------------

export async function openYouTubeMusic(): Promise<boolean> {
  try {
    await execAsync(`open -a "Safari" "https://music.youtube.com"`);
    return true;
  } catch (e) {
    console.error("openYouTubeMusic failed:", e);
    return false;
  }
}

export async function youtubeMusicSearch(query: string): Promise<boolean> {
  try {
    const encoded = encodeURIComponent(query);
    await execAsync(`open -a "Safari" "https://music.youtube.com/search?q=${encoded}"`);
    return true;
  } catch (e) {
    console.error("youtubeMusicSearch failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// System Audio
// ------------------------------------------------------------------

export async function setSystemVolume(level: number): Promise<boolean> {
  try {
    const vol = Math.max(0, Math.min(100, level));
    await execAsync(`osascript -e 'set volume output volume ${vol}'`);
    return true;
  } catch (e) {
    console.error("setSystemVolume failed:", e);
    return false;
  }
}

export async function muteSystemVolume(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set volume output volume 0'`);
    return true;
  } catch (e) {
    console.error("muteSystemVolume failed:", e);
    return false;
  }
}

export async function unmuteSystemVolume(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set volume output volume 50'`);
    return true;
  } catch (e) {
    console.error("unmuteSystemVolume failed:", e);
    return false;
  }
}

export class MediaPlayerLayer {
  // Spotify
  spotifyPlay = spotifyPlay;
  spotifyPause = spotifyPause;
  spotifyToggle = spotifyToggle;
  spotifyNext = spotifyNext;
  spotifyPrevious = spotifyPrevious;
  spotifyVolume = spotifyVolume;
  spotifyGetTrack = spotifyGetCurrentTrack;
  spotifyPlayPlaylist = spotifyPlayPlaylist;
  
  // Apple Music
  appleMusicPlay = appleMusicPlay;
  appleMusicPause = appleMusicPause;
  appleMusicToggle = appleMusicToggle;
  appleMusicNext = appleMusicNext;
  
  // YouTube Music
  openYouTubeMusic = openYouTubeMusic;
  youtubeMusicSearch = youtubeMusicSearch;
  
  // System
  setSystemVolume = setSystemVolume;
  mute = muteSystemVolume;
  unmute = unmuteSystemVolume;
}
