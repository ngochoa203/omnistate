import type { IntentHandler } from "./types.js";

export const browserOpen: IntentHandler = async (args, ctx) => {
  const url = String(args.url ?? "");
  const browser = String(args.browser ?? "default");
  if (browser === "default") {
    await ctx.layers.deep.execAsync(`open "${url}"`, 5000);
  } else {
    await ctx.layers.deep.execAsync(`open -a "${browser}" "${url}"`, 5000);
  }
  return { speak: "URL opened.", data: { success: true, url, browser } };
};

export const browserNewTab: IntentHandler = async (args, ctx) => {
  const browser = args.browser as string | undefined;
  if (browser) {
    const tab = await ctx.layers.browser.newTab(args.url as string | undefined, browser);
    return { speak: "New tab opened.", data: { tab } };
  }
  const url = String(args.url ?? "about:blank");
  await ctx.layers.deep.runAppleScript(`
tell application "Google Chrome"
  activate
  make new tab at end of tabs of front window with properties {URL:"${url}"}
end tell`);
  return { speak: "New tab opened.", data: { success: true, url } };
};

export const browserCloseTab: IntentHandler = async (args, ctx) => {
  const browser = args.browser as string | undefined;
  if (browser) {
    await ctx.layers.browser.closeTab(args.tabIndex as number | undefined, browser);
    return { speak: "Tab closed.", data: { success: true } };
  }
  await ctx.layers.deep.runAppleScript(`
tell application "Google Chrome"
  close active tab of front window
end tell`);
  return { speak: "Tab closed.", data: { success: true, action: "tab closed" } };
};

export const browserFillForm: IntentHandler = async (args, ctx) => {
  const fields = (args.fields as Record<string, string>) ?? {};
  const filled: string[] = [];
  for (const [selector, value] of Object.entries(fields)) {
    const safeSelector = selector.replace(/'/g, "\\'").replace(/"/g, '\\"');
    const safeValue = value.replace(/'/g, "\\'").replace(/"/g, '\\"');
    await ctx.layers.deep.runAppleScript(`
tell application "Google Chrome"
  execute front window's active tab javascript "var el = document.querySelector('${safeSelector}') || document.querySelector('[name=\\"${safeSelector}\\"]') || document.querySelector('[placeholder*=\\"${safeSelector}\\"]'); if (el) { el.value = '${safeValue}'; el.dispatchEvent(new Event('input', {bubbles:true})); }"
end tell`);
    filled.push(`${selector}: filled`);
  }
  return { speak: "Form filled.", data: { success: true, filled } };
};

export const browserScrape: IntentHandler = async (args, ctx) => {
  const selector = String(args.selector ?? "body");
  const attribute = String(args.attribute ?? "textContent");
  const result = await ctx.layers.deep.runAppleScript(`
tell application "Google Chrome"
  set jsResult to execute front window's active tab javascript "JSON.stringify(Array.from(document.querySelectorAll('${selector}')).map(el => el.${attribute}).slice(0, 50))"
  return jsResult
end tell`);
  return { speak: "Page scraped.", data: { success: true, data: result, selector } };
};

export const browserDownload: IntentHandler = async (args, ctx) => {
  const url = String(args.url ?? "");
  const output = String(args.output ?? args.path ?? "~/Downloads/");
  await ctx.layers.deep.execAsync(`curl -L -o "${output}" "${url}"`, 120000);
  return { speak: "File downloaded.", data: { success: true, url, output } };
};

export const browserBookmark: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.deep.runAppleScript(`
tell application "Google Chrome"
  set bookmarkURL to URL of active tab of front window
  set bookmarkTitle to title of active tab of front window
  return bookmarkTitle & "|" & bookmarkURL
end tell`);
  const [title, url] = (result ?? "").split("|");
  return { speak: "Tab bookmarked.", data: { success: true, url: url ?? args.url, title: title ?? args.title, action: "bookmarked" } };
};

export const browserListTabs: IntentHandler = async (args, ctx) => {
  const tabs = await ctx.layers.browser.listTabs(args.browser as string | undefined);
  return { speak: "Tabs listed.", data: { tabs } };
};

export const browserGetActiveTab: IntentHandler = async (args, ctx) => {
  const tab = await ctx.layers.browser.getActiveTab(args.browser as string | undefined);
  return { speak: "Active tab retrieved.", data: { tab } };
};

export const browserSwitchTab: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.switchTab(args.tabIndex as number, args.browser as string | undefined);
  return { speak: "Tab switched.", data: { success: true } };
};

export const browserReloadTab: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.reloadTab(args.browser as string | undefined);
  return { speak: "Tab reloaded.", data: { success: true } };
};

export const browserDuplicateTab: IntentHandler = async (args, ctx) => {
  const browser = args.browser as string | undefined;
  const tab = await ctx.layers.browser.getActiveTab(browser);
  await ctx.layers.browser.newTab(tab.url, browser);
  return { speak: "Tab duplicated.", data: { success: true } };
};

export const browserNavigateTo: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.navigate(args.url as string, args.browser as string | undefined);
  return { speak: "Navigated.", data: { success: true } };
};

export const browserGoBack: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.goBack(args.browser as string | undefined);
  return { speak: "Went back.", data: { success: true } };
};

export const browserGoForward: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.goForward(args.browser as string | undefined);
  return { speak: "Went forward.", data: { success: true } };
};

export const browserGetUrl: IntentHandler = async (args, ctx) => {
  const url = await ctx.layers.browser.getPageUrl(args.browser as string | undefined);
  return { speak: "URL retrieved.", data: { url } };
};

export const browserGetTitle: IntentHandler = async (args, ctx) => {
  const title = await ctx.layers.browser.getPageTitle(args.browser as string | undefined);
  return { speak: "Page title retrieved.", data: { title } };
};

export const browserGetPageSource: IntentHandler = async (args, ctx) => {
  const html = await ctx.layers.browser.getPageHtml(args.browser as string | undefined);
  return { speak: "Page source retrieved.", data: { html } };
};

export const browserExecuteJs: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.browser.executeJavaScript(args.script as string, args.browser as string | undefined);
  return { speak: "JavaScript executed.", data: { result } };
};

export const browserQuerySelector: IntentHandler = async (args, ctx) => {
  const element = await ctx.layers.browser.querySelector(args.selector as string, args.browser as string | undefined);
  return { speak: "Element found.", data: { element } };
};

export const browserQuerySelectorAll: IntentHandler = async (args, ctx) => {
  const elements = await ctx.layers.browser.querySelectorAll(args.selector as string, args.browser as string | undefined);
  return { speak: "Elements found.", data: { elements } };
};

export const browserGetElementText: IntentHandler = async (args, ctx) => {
  const element = await ctx.layers.browser.querySelector(args.selector as string, args.browser as string | undefined);
  return { speak: "Element text retrieved.", data: { text: (element as any)?.text ?? "" } };
};

export const browserGetElementAttribute: IntentHandler = async (args, ctx) => {
  const element = await ctx.layers.browser.querySelector(args.selector as string, args.browser as string | undefined);
  return { speak: "Element attribute retrieved.", data: { value: (element as any)?.[args.attribute as string] ?? "" } };
};

export const browserFillInput: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.fillForm(
    [{ selector: args.selector as string, value: args.value as string }],
    args.browser as string | undefined,
  );
  return { speak: "Input filled.", data: { success: true } };
};

export const browserClickElement: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.clickElement(args.selector as string, args.browser as string | undefined);
  return { speak: "Element clicked.", data: { success: true } };
};

export const browserSubmitForm: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.submitForm(args.selector as string | undefined, args.browser as string | undefined);
  return { speak: "Form submitted.", data: { success: true } };
};

export const browserSelectOption: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.selectOption(args.selector as string, args.value as string, args.browser as string | undefined);
  return { speak: "Option selected.", data: { success: true } };
};

export const browserGetCookies: IntentHandler = async (args, ctx) => {
  const cookies = await ctx.layers.browser.getCookies(args.domain as string | undefined, args.browser as string | undefined);
  return { speak: "Cookies retrieved.", data: { cookies } };
};

export const browserSetCookie: IntentHandler = async () => {
  return { speak: "Use browser.executeJs to set cookies directly.", data: { note: "Use browser.executeJs to set cookies directly" } };
};

export const browserGetLocalStorage: IntentHandler = async (args, ctx) => {
  const value = await ctx.layers.browser.getLocalStorage(args.key as string, args.browser as string | undefined);
  return { speak: "Local storage value retrieved.", data: { value } };
};

export const browserSetLocalStorage: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.setLocalStorage(args.key as string, args.value as string, args.browser as string | undefined);
  return { speak: "Local storage value set.", data: { success: true } };
};

export const browserScreenshot: IntentHandler = async (args, ctx) => {
  const buffer = await ctx.layers.browser.capturePageScreenshot(args.browser as string | undefined);
  return { speak: "Screenshot captured.", data: { data: buffer.toString("base64"), format: "png" } };
};

export const browserSavePdf: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.savePageAsPdf(args.outputPath as string, args.browser as string | undefined);
  return { speak: "Page saved as PDF.", data: { success: true } };
};

export const browserStartHeadless: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.browser.startHeadlessBrowser(args as any);
  return { speak: "Headless browser started.", data: result as Record<string, unknown> };
};

export const browserStopHeadless: IntentHandler = async (_args, ctx) => {
  await ctx.layers.browser.stopHeadlessBrowser();
  return { speak: "Headless browser stopped.", data: { success: true } };
};

export const browserIsHeadlessRunning: IntentHandler = async (_args, ctx) => {
  const running = await ctx.layers.browser.isHeadlessRunning();
  return { speak: running ? "Headless browser is running." : "Headless browser is not running.", data: { running } };
};

export const browserExecuteInHeadless: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.browser.executeInHeadless(args.url as string, args.script as string);
  return { speak: "Script executed in headless browser.", data: { result } };
};

export const browserPinTab: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.pinTab(args.tabIndex as number | undefined, args.browser as string | undefined);
  return { speak: "Tab pinned.", data: { success: true } };
};

export const browserMuteTab: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.muteTab(args.tabIndex as number | undefined, args.browser as string | undefined);
  return { speak: "Tab muted.", data: { success: true } };
};

export const browserUnmuteTab: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.unmuteTab(args.tabIndex as number | undefined, args.browser as string | undefined);
  return { speak: "Tab unmuted.", data: { success: true } };
};

export const browserGetTabMemory: IntentHandler = async (_args, ctx) => {
  const memory = await ctx.layers.browser.getTabMemory();
  return { speak: "Tab memory retrieved.", data: { memory } };
};

export const browserGetDownloads: IntentHandler = async (args, ctx) => {
  const downloads = await ctx.layers.browser.getDownloads(args.limit as number | undefined, args.browser as string | undefined);
  return { speak: "Downloads retrieved.", data: { downloads } };
};

export const browserClearDownloads: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.clearDownloads(args.browser as string | undefined);
  return { speak: "Downloads cleared.", data: { success: true } };
};

export const browserGetDownloadDirectory: IntentHandler = async (args, ctx) => {
  const directory = await ctx.layers.browser.getDownloadDirectory(args.browser as string | undefined);
  return { speak: "Download directory retrieved.", data: { directory } };
};

export const browserGetBookmarks: IntentHandler = async (args, ctx) => {
  const bookmarks = await ctx.layers.browser.getBookmarks(args.folder as string | undefined, args.browser as string | undefined);
  return { speak: "Bookmarks retrieved.", data: { bookmarks } };
};

export const browserAddBookmark: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.addBookmark(
    args.url as string,
    (args.title as string | undefined) ?? "Bookmark",
    args.folder as string | undefined,
    args.browser as string | undefined,
  );
  return { speak: "Bookmark added.", data: { success: true } };
};

export const browserSearchBookmarks: IntentHandler = async (args, ctx) => {
  const bookmarks = await ctx.layers.browser.searchBookmarks(args.query as string, args.browser as string | undefined);
  return { speak: "Bookmarks searched.", data: { bookmarks } };
};

export const browserGetHistory: IntentHandler = async (args, ctx) => {
  const history = await ctx.layers.browser.getHistory(args.limit as number | undefined, undefined, args.browser as string | undefined);
  return { speak: "History retrieved.", data: { history } };
};

export const browserGetPageLoadTime: IntentHandler = async (args, ctx) => {
  const loadTime = await ctx.layers.browser.getPageLoadTime(undefined, args.browser as string | undefined);
  return { speak: "Page load time retrieved.", data: { loadTime } };
};

export const browserGetNetworkRequests: IntentHandler = async (args, ctx) => {
  const requests = await ctx.layers.browser.getNetworkRequests(undefined, args.browser as string | undefined);
  return { speak: "Network requests retrieved.", data: { requests } };
};

export const browserBlockUrls: IntentHandler = async (args, ctx) => {
  await ctx.layers.browser.blockUrls(args.patterns as string[]);
  return { speak: "URLs blocked.", data: { success: true } };
};
