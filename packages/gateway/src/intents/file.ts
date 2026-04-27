import type { IntentHandler } from "./types.js";

export const fileRead: IntentHandler = async (args, ctx) => {
  const content = ctx.layers.deep.readFile(args.path as string);
  return { speak: "File read.", data: { content } };
};

export const fileWrite: IntentHandler = async (args, ctx) => {
  ctx.layers.deep.writeFile(args.path as string, args.content as string);
  return { speak: "File written.", data: { path: args.path } };
};

export const filePermissions: IntentHandler = async (args, ctx) => {
  const perms = await ctx.layers.deepOS!.getFilePermissions(args.path as string);
  return { speak: "File permissions retrieved.", data: { perms } };
};

export const fileChmod: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setFilePermissions(args.path as string, args.mode as string);
  return { speak: "File permissions set.", data: { success } };
};

export const fileChown: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setFileOwner(
    args.path as string,
    args.owner as string,
    args.group as string | undefined,
  );
  return { speak: "File owner changed.", data: { success } };
};

export const fileCreate: IntentHandler = async (args, ctx) => {
  const path = String(args.path ?? "");
  const type = String(args.type ?? "file");
  const content = String(args.content ?? "");
  if (type === "directory") {
    await ctx.layers.deep.execAsync(`mkdir -p "${path}"`, 5000);
  } else {
    await ctx.layers.deep.execAsync(
      `mkdir -p "$(dirname "${path}")" && printf '%s' ${JSON.stringify(content)} > "${path}"`,
      5000,
    );
  }
  return { speak: "File created.", data: { success: true, path, type } };
};

export const fileCopy: IntentHandler = async (args, ctx) => {
  const src = String(args.source ?? args.src ?? "");
  const dest = String(args.destination ?? args.dest ?? "");
  const recursive = args.recursive !== false;
  const flag = recursive ? "-R" : "";
  await ctx.layers.deep.execAsync(`cp ${flag} "${src}" "${dest}"`, 30000);
  return { speak: "File copied.", data: { success: true, source: src, destination: dest } };
};

export const fileMove: IntentHandler = async (args, ctx) => {
  const src = String(args.source ?? args.src ?? "");
  const dest = String(args.destination ?? args.dest ?? "");
  await ctx.layers.deep.execAsync(`mv "${src}" "${dest}"`, 30000);
  return { speak: "File moved.", data: { success: true, source: src, destination: dest } };
};

export const fileRenameBatch: IntentHandler = async (args, ctx) => {
  const dir = String(args.directory ?? args.dir ?? ".");
  const pattern = String(args.pattern ?? "");
  const replacement = String(args.replacement ?? "");
  const { stdout: renameOut } = await ctx.layers.deep.execAsync(
    `cd "${dir}" && for f in *${pattern}*; do mv "$f" "$(echo "$f" | sed "s/${pattern}/${replacement}/g")"; done 2>&1`,
    30000,
  );
  return {
    speak: "Files renamed.",
    data: { success: true, directory: dir, pattern, replacement, output: renameOut },
  };
};

export const fileDelete: IntentHandler = async (args, ctx) => {
  const path = String(args.path ?? "");
  const permanent = Boolean(args.permanent ?? false);
  if (permanent) {
    await ctx.layers.deep.execAsync(`rm -rf "${path}"`, 10000);
  } else {
    await ctx.layers.deep.runAppleScript(`tell application "Finder" to delete POSIX file "${path}"`);
  }
  return { speak: "File deleted.", data: { success: true, path, permanent } };
};

export const fileSearch: IntentHandler = async (args, ctx) => {
  const name = String(args.name ?? args.query ?? "");
  const content = String(args.content ?? "");
  const dir = String(args.directory ?? args.dir ?? "~");
  let fsCmd: string;
  if (content) {
    fsCmd = `grep -rl "${content}" "${dir}" 2>/dev/null | head -20`;
  } else {
    fsCmd = `find "${dir}" -name "*${name}*" -maxdepth 5 2>/dev/null | head -20`;
  }
  const { stdout: fsOut } = await ctx.layers.deep.execAsync(fsCmd, 15000);
  const fsFiles = (fsOut ?? "").split("\n").filter(Boolean);
  return { speak: "Search complete.", data: { success: true, results: fsFiles, count: fsFiles.length } };
};

export const fileZip: IntentHandler = async (args, ctx) => {
  const source = String(args.source ?? args.path ?? "");
  const output = String(args.output ?? `${source}.zip`);
  await ctx.layers.deep.execAsync(`zip -r "${output}" "${source}"`, 60000);
  return { speak: "Archive created.", data: { success: true, source, output } };
};

export const fileUnzip: IntentHandler = async (args, ctx) => {
  const source = String(args.source ?? args.path ?? "");
  const dest = String(args.destination ?? args.dest ?? ".");
  await ctx.layers.deep.execAsync(`unzip -o "${source}" -d "${dest}"`, 60000);
  return { speak: "Archive extracted.", data: { success: true, source, destination: dest } };
};

export const fileOrganizeDesktop: IntentHandler = async (args, ctx) => {
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

export const fileList: IntentHandler = async (args, ctx) => {
  const entries = await ctx.layers.deep.listDirectory(String(args.path), args as any);
  return { speak: "Directory listed.", data: { entries } };
};

export const fileMetadata: IntentHandler = async (args, ctx) => {
  const metadata = await ctx.layers.deep.getMetadata(String(args.path));
  return { speak: "Metadata retrieved.", data: { metadata } };
};

export const fileExists: IntentHandler = async (args, ctx) => {
  const exists = await ctx.layers.deep.fileExists(String(args.path));
  return { speak: exists ? "File exists." : "File not found.", data: { exists } };
};

export const fileSize: IntentHandler = async (args, ctx) => {
  const size = await ctx.layers.deep.getFileSize(String(args.path));
  return { speak: "File size retrieved.", data: { size } };
};

export const fileHash: IntentHandler = async (args, ctx) => {
  const hash = await ctx.layers.deep.getFileHash(String(args.path), args.algorithm as string | undefined);
  return { speak: "File hash computed.", data: { hash } };
};

export const fileTouch: IntentHandler = async (args, ctx) => {
  await ctx.layers.deep.touchFile(String(args.path));
  return { speak: "File touched.", data: { success: true } };
};

export const fileAppend: IntentHandler = async (args, ctx) => {
  await ctx.layers.deep.appendFile(String(args.path), String(args.content));
  return { speak: "File appended.", data: { success: true } };
};

export const fileSymlink: IntentHandler = async (args, ctx) => {
  await ctx.layers.deep.createSymlink(String(args.target), String(args.linkPath));
  return { speak: "Symlink created.", data: { success: true } };
};

export const fileResolveSymlink: IntentHandler = async (args, ctx) => {
  const resolved = await ctx.layers.deep.resolveSymlink(String(args.path));
  return { speak: "Symlink resolved.", data: { resolved } };
};

export const fileDiskSpace: IntentHandler = async (args, ctx) => {
  const space = await ctx.layers.deep.getDiskSpace(args.path as string | undefined);
  return { speak: "Disk space retrieved.", data: space as Record<string, unknown> };
};

export const fileCompare: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.deep.compareFiles(String(args.pathA), String(args.pathB));
  return { speak: "Files compared.", data: result as Record<string, unknown> };
};

export const fileMkdir: IntentHandler = async (args, ctx) => {
  await ctx.layers.deep.createDirectory(String(args.path));
  return { speak: "Directory created.", data: { success: true } };
};

export const fileReadBuffer: IntentHandler = async (args, ctx) => {
  const buffer = await ctx.layers.deep.readFileBuffer(String(args.path));
  return { speak: "File read.", data: { data: buffer.toString("base64"), size: buffer.length } };
};

export const fileGetPermissions: IntentHandler = async (args, ctx) => {
  const perms = await ctx.layers.deep.getPermissions(String(args.path));
  return { speak: "Permissions retrieved.", data: perms as Record<string, unknown> };
};

export const fileSetPermissions: IntentHandler = async (args, ctx) => {
  await ctx.layers.deep.setPermissions(String(args.path), String(args.mode));
  return { speak: "Permissions set.", data: { success: true } };
};

export const fileWatch: IntentHandler = async (args, ctx) => {
  const watcher = await ctx.layers.deep.watchDirectory(String(args.path), () => {});
  setTimeout(() => watcher.stop(), (args.timeoutMs as number) ?? 30000);
  return { speak: "Watching started.", data: { success: true, note: "Watching started" } };
};
