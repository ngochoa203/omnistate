import type { IntentHandler } from "./types.js";

// Surface layer media controls (keyboard-based)
export const mediaToggle: IntentHandler = async (_args, ctx) => {
  await ctx.layers.surface.keyTap("space", { meta: false });
  return { speak: "Media toggled.", data: { success: true, action: "media toggled" } };
};

export const mediaNext: IntentHandler = async (_args, ctx) => {
  await ctx.layers.deep.runAppleScript(`tell application "Music" to next track`);
  return { speak: "Next track.", data: { success: true, action: "next track" } };
};

export const mediaPrevious: IntentHandler = async (_args, ctx) => {
  await ctx.layers.deep.runAppleScript(`tell application "Music" to previous track`);
  return { speak: "Previous track.", data: { success: true, action: "previous track" } };
};

export const mediaInfo: IntentHandler = async (_args, ctx) => {
  const result = await ctx.layers.deep.runAppleScript(`
    tell application "Music"
      set trackName to name of current track
      set trackArtist to artist of current track
      set trackAlbum to album of current track
      return trackName & " - " & trackArtist & " (" & trackAlbum & ")"
    end tell
  `);
  return { speak: result ?? "Unknown track.", data: { success: true, nowPlaying: result } };
};

// Media layer wrappers
export const mediaPlay: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  await media.play();
  return { speak: "Playing.", data: { success: true } };
};

export const mediaPause: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  await media.pause();
  return { speak: "Paused.", data: { success: true } };
};

export const mediaTogglePlayPause: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  await media.togglePlayPause();
  return { speak: "Play/pause toggled.", data: { success: true } };
};

export const mediaNextTrack: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  await media.nextTrack();
  return { speak: "Next track.", data: { success: true } };
};

export const mediaPreviousTrack: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  await media.previousTrack();
  return { speak: "Previous track.", data: { success: true } };
};

export const mediaGetCurrentTrack: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  const track = await media.getCurrentTrack();
  return { speak: "Current track retrieved.", data: { track } };
};

export const mediaSetPosition: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.setPosition(args.seconds as number);
  return { speak: "Position set.", data: { success: true } };
};

export const mediaGetQueue: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  const queue = await media.getQueue(args.limit as number | undefined);
  return { speak: "Queue retrieved.", data: { queue } };
};

export const mediaGetPlayerVolume: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  const volume = await media.getPlayerVolume(args.app as "music" | "spotify" | undefined);
  return { speak: "Player volume retrieved.", data: { volume } };
};

export const mediaSetPlayerVolume: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.setPlayerVolume(args.level as number, args.app as "music" | "spotify" | undefined);
  return { speak: "Player volume set.", data: { success: true } };
};

export const mediaGetAudioOutput: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  const device = await media.getAudioOutput();
  return { speak: "Audio output retrieved.", data: { device } };
};

export const mediaSetAudioOutput: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.setAudioOutput(args.deviceName as string);
  return { speak: "Audio output set.", data: { success: true } };
};

export const mediaGetPlaylists: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  const playlists = await media.getPlaylists(args.app as "music" | "spotify" | undefined);
  return { speak: "Playlists retrieved.", data: { playlists } };
};

export const mediaPlayPlaylist: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.playPlaylist(args.name as string, args.app as "music" | "spotify" | undefined);
  return { speak: "Playlist started.", data: { success: true } };
};

export const mediaAddToPlaylist: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.addToPlaylist(args.trackName as string, args.playlistName as string);
  return { speak: "Track added to playlist.", data: { success: true } };
};

export const mediaCreatePlaylist: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.createPlaylist(args.name as string, args.app as "music" | "spotify" | undefined);
  return { speak: "Playlist created.", data: { success: true } };
};

export const mediaSearchTracks: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  const results = await media.searchTracks(args.query as string, args.app as "music" | "spotify" | undefined);
  return { speak: "Track search complete.", data: { results } };
};

export const mediaGetAirPlayDevices: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  const devices = await media.getAirPlayDevices();
  return { speak: "AirPlay devices retrieved.", data: { devices } };
};

export const mediaSetAirPlayDevice: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.setAirPlayDevice(args.deviceName as string);
  return { speak: "AirPlay device set.", data: { success: true } };
};

export const mediaIsAirPlaying: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  const playing = await media.isAirPlaying();
  return { speak: playing ? "AirPlay is active." : "AirPlay is not active.", data: { playing } };
};

export const mediaStopAirPlay: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  await media.stopAirPlay();
  return { speak: "AirPlay stopped.", data: { success: true } };
};

export const mediaGetVideoPlayers: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  const players = await media.getVideoPlayers();
  return { speak: "Video players retrieved.", data: { players } };
};

export const mediaControlVideo: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.controlVideo(args.action);
  return { speak: "Video control applied.", data: { success: true } };
};

export const mediaGetVideoInfo: IntentHandler = async (_args, ctx) => {
  const media = ctx.layers.media as any;
  const info = await media.getVideoInfo();
  return { speak: "Video info retrieved.", data: { info } };
};

export const mediaSetVideoPosition: IntentHandler = async (args, ctx) => {
  const media = ctx.layers.media as any;
  await media.setVideoPosition(args.seconds as number);
  return { speak: "Video position set.", data: { success: true } };
};

// Vision handlers
export const visionModalDetect: IntentHandler = async (_args, ctx) => {
  const vision = ctx.layers.vision as any;
  const modal = await vision.detectModal();
  return { speak: "Modal detected.", data: { modal } };
};

export const visionModalDismiss: IntentHandler = async (args, ctx) => {
  const vision = ctx.layers.vision as any;
  const handled = await vision.dismissModal((args.action as "accept" | "dismiss" | "close" | undefined) ?? "dismiss");
  return { speak: "Modal dismissed.", data: { handled } };
};

export const visionCaptchaDetect: IntentHandler = async (_args, ctx) => {
  const vision = ctx.layers.vision as any;
  const captcha = await vision.detectCaptcha();
  return { speak: captcha ? "Captcha detected." : "No captcha detected.", data: { captcha, present: captcha !== null } };
};

export const visionTableDetect: IntentHandler = async (_args, ctx) => {
  const vision = ctx.layers.vision as any;
  const tables = await vision.detectTables();
  return { speak: "Tables detected.", data: { tables } };
};

export const visionTableExtract: IntentHandler = async (args, ctx) => {
  const vision = ctx.layers.vision as any;
  const capture = await ctx.layers.surface.captureScreen();
  const region =
    typeof args.x === "number" && typeof args.y === "number" &&
    typeof args.width === "number" && typeof args.height === "number"
      ? { x: args.x as number, y: args.y as number, width: args.width as number, height: args.height as number }
      : undefined;
  const table = await vision.extractTable(capture.data, region);
  const json = vision.tableToJSON(table);
  const csv = vision.tableToCSV(table);
  return { speak: "Table extracted.", data: { table, json, csv } };
};

export const visionA11yAudit: IntentHandler = async (_args, ctx) => {
  const vision = ctx.layers.vision as any;
  const report = await vision.auditAccessibility();
  return { speak: "Accessibility audit complete.", data: { report } };
};

export const visionLanguageDetect: IntentHandler = async (_args, ctx) => {
  const vision = ctx.layers.vision as any;
  const language = await vision.detectUILanguage();
  return { speak: "UI language detected.", data: { language } };
};

export const visionTranslate: IntentHandler = async (_args, ctx) => {
  const capture = await ctx.layers.surface.captureScreen();
  if (!capture) return { speak: "Screen capture failed.", data: { success: false, error: "Screen capture failed" } };
  const { stdout: ocrOut } = await ctx.layers.deep.execAsync(
    "screencapture -x /tmp/omni_translate.png && shortcuts run 'Live Text' -i /tmp/omni_translate.png 2>/dev/null || echo 'OCR not available'",
    15000,
  );
  return { speak: "Text extracted for translation.", data: { success: true, text: ocrOut, action: "text extracted for translation" } };
};

export const visionOcr: IntentHandler = async (args, ctx) => {
  const region = args.region as { x: number; y: number; width: number; height: number } | undefined;
  if (region) {
    await ctx.layers.deep.execAsync(
      `screencapture -x -R${region.x},${region.y},${region.width},${region.height} /tmp/omni_ocr.png`,
      5000,
    );
  } else {
    await ctx.layers.deep.execAsync("screencapture -x /tmp/omni_ocr.png", 5000);
  }
  const { stdout: tesseractOut } = await ctx.layers.deep.execAsync(
    "tesseract /tmp/omni_ocr.png stdout 2>/dev/null || echo 'Tesseract not installed. Install with: brew install tesseract'",
    15000,
  );
  return { speak: "OCR complete.", data: { success: true, text: tesseractOut?.trim(), region } };
};

export const visionContext: IntentHandler = async (_args, ctx) => {
  const bridge = ctx.layers.bridge as any;
  const tree = bridge?.getUiTree?.();
  const activeApp = (tree as any)?.title ?? "Unknown";
  const windowTitle = (tree as any)?.children?.[0]?.title ?? "";
  const { stdout: appsListOut } = await ctx.layers.deep.execAsync(
    "osascript -e 'tell application \"System Events\" to get name of every process whose background only is false'",
    5000,
  );
  const doc = await ctx.layers.deep.runAppleScript(`
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
      return frontApp
    end tell
  `);
  return {
    speak: `You are in ${activeApp}.`,
    data: {
      success: true,
      activeApp,
      windowTitle,
      openApps: appsListOut?.split(", ") ?? [],
      frontApp: doc,
      context: `You are in ${activeApp}${windowTitle ? ` - "${windowTitle}"` : ""}`,
    },
  };
};

export const visionOrganizeDesktop: IntentHandler = async (args, ctx) => {
  const desktop = String(args.path ?? "~/Desktop");
  const orgScript = `
    cd "${desktop}" && \
    mkdir -p Documents Images Videos Music Archives Code Other && \
    mv -n *.{pdf,doc,docx,txt,pages,xlsx,csv,pptx} Documents/ 2>/dev/null; \
    mv -n *.{jpg,jpeg,png,gif,svg,ico,webp,heic,raw,tiff} Images/ 2>/dev/null; \
    mv -n *.{mp4,mov,avi,mkv,wmv,flv,webm} Videos/ 2>/dev/null; \
    mv -n *.{mp3,wav,flac,aac,ogg,m4a} Music/ 2>/dev/null; \
    mv -n *.{zip,rar,7z,tar,gz,dmg,iso} Archives/ 2>/dev/null; \
    mv -n *.{js,ts,py,rs,go,java,c,cpp,h,rb,php,swift,kt} Code/ 2>/dev/null; \
    echo "Desktop organized"
  `;
  const { stdout: orgOut } = await ctx.layers.deep.execAsync(orgScript, 30000);
  return { speak: "Desktop organized.", data: { success: true, path: desktop, output: orgOut } };
};
