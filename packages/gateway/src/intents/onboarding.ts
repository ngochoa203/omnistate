/**
 * Onboarding Shortcuts — pre-built shortcuts for non-technical users.
 */

export interface OnboardingShortcut {
  id: string;
  category: "daily" | "system" | "communication" | "media" | "security";
  title: string;
  titleVi: string;
  description: string;
  descriptionVi: string;
  examples: Array<{ phrase: string; intent: string }>;
  intent: string;
  args?: Record<string, unknown>;
}

export interface OnboardingGuide {
  id: string;
  title: string;
  titleVi: string;
  steps: Array<{ step: number; instruction: string; instructionVi: string; intent: string; args?: Record<string, unknown> }>;
}

export const TOP_SHORTCUTS: OnboardingShortcut[] = [
  {
    id: "open-app",
    category: "daily",
    title: "Open App",
    titleVi: "Mở ứng dụng",
    description: "Open any app on your Mac",
    descriptionVi: "Mở bất kỳ ứng dụng nào trên máy Mac",
    examples: [
      { phrase: "mở Safari", intent: "app.launch" },
      { phrase: "bật Slack", intent: "app.launch" },
      { phrase: "open Spotify", intent: "app.launch" },
    ],
    intent: "app.launch",
    args: { name: "" },
  },
  {
    id: "check-battery",
    category: "system",
    title: "Check Battery",
    titleVi: "Kiểm tra pin",
    description: "Check your Mac battery level and health",
    descriptionVi: "Xem mức pin và tình trạng pin máy Mac",
    examples: [
      { phrase: "pin còn bao nhiêu", intent: "hardware.getBatteryStatus" },
      { phrase: "battery level", intent: "hardware.getBatteryStatus" },
      { phrase: "kiểm tra pin", intent: "hardware.getBatteryStatus" },
    ],
    intent: "hardware.getBatteryStatus",
  },
  {
    id: "wifi-toggle",
    category: "system",
    title: "Toggle Wi-Fi",
    titleVi: "Bật/tắt Wi-Fi",
    description: "Turn Wi-Fi on or off",
    descriptionVi: "Bật hoặc tắt Wi-Fi",
    examples: [
      { phrase: "bật wifi", intent: "wifi.toggle" },
      { phrase: "tắt wifi đi", intent: "wifi.toggle" },
      { phrase: "turn on wifi", intent: "wifi.toggle" },
    ],
    intent: "wifi.toggle",
  },
  {
    id: "volume-control",
    category: "system",
    title: "Volume Control",
    titleVi: "Điều chỉnh âm lượng",
    description: "Adjust or mute your Mac's volume",
    descriptionVi: "Tăng, giảm hoặc tắt tiếng máy Mac",
    examples: [
      { phrase: "tăng volume", intent: "hardware.setVolume" },
      { phrase: "tắt tiếng đi", intent: "audio.mute" },
      { phrase: "volume up", intent: "hardware.setVolume" },
    ],
    intent: "hardware.setVolume",
    args: { level: 50 },
  },
  {
    id: "alarm-timer",
    category: "daily",
    title: "Set Alarm/Timer",
    titleVi: "Đặt báo thức / hẹn giờ",
    description: "Set a timer or alarm",
    descriptionVi: "Đặt hẹn giờ hoặc báo thức",
    examples: [
      { phrase: "đặt báo thức 7 giờ", intent: "alarm.set" },
      { phrase: "hẹn giờ 10 phút", intent: "alarm.set" },
      { phrase: "set alarm for 7am", intent: "alarm.set" },
    ],
    intent: "alarm.set",
    args: { seconds: 300 },
  },
  {
    id: "notes",
    category: "communication",
    title: "Create Note",
    titleVi: "Tạo ghi chú",
    description: "Quickly create a note",
    descriptionVi: "Tạo nhanh một ghi chú",
    examples: [
      { phrase: "ghi chú hôm nay", intent: "note.create" },
      { phrase: "tạo note", intent: "note.create" },
      { phrase: "take a note", intent: "note.create" },
    ],
    intent: "note.create",
    args: { text: "" },
  },
  {
    id: "screenshot",
    category: "daily",
    title: "Take Screenshot",
    titleVi: "Chụp màn hình",
    description: "Capture your screen",
    descriptionVi: "Chụp ảnh màn hình",
    examples: [
      { phrase: "chụp màn hình", intent: "ui.interaction" },
      { phrase: "screenshot", intent: "ui.interaction" },
    ],
    intent: "ui.interaction",
    args: { action: "screenshot" },
  },
  {
    id: "dark-mode",
    category: "system",
    title: "Dark Mode",
    titleVi: "Chế độ tối",
    description: "Toggle dark mode",
    descriptionVi: "Bật hoặc tắt chế độ tối",
    examples: [
      { phrase: "bật chế độ tối", intent: "os.darkMode" },
      { phrase: "dark mode", intent: "os.darkMode" },
    ],
    intent: "os.darkMode",
    args: { enabled: true },
  },
  {
    id: "reminder",
    category: "daily",
    title: "Set Reminder",
    titleVi: "Đặt nhắc nhở",
    description: "Create a reminder",
    descriptionVi: "Tạo lời nhắc nhở",
    examples: [
      { phrase: "nhắc tôi 3 giờ", intent: "reminder.set" },
      { phrase: "tạo reminder", intent: "reminder.set" },
    ],
    intent: "reminder.set",
    args: { text: "" },
  },
  {
    id: "system-health",
    category: "system",
    title: "System Health Check",
    titleVi: "Kiểm tra sức khỏe máy",
    description: "Quick health check of your Mac",
    descriptionVi: "Kiểm tra nhanh tình trạng máy Mac",
    examples: [
      { phrase: "máy tôi chạy tốt không", intent: "system.info" },
      { phrase: "health check", intent: "health.notify" },
    ],
    intent: "system.info",
  },
];

export const GUIDES: OnboardingGuide[] = [
  {
    id: "how-to-open-app",
    title: "How to Open an App",
    titleVi: "Cách mở ứng dụng",
    steps: [
      { step: 1, instruction: "Say 'open [app name]' or 'mở [tên app]'", instructionVi: "Nói 'mở Safari' hoặc 'open Slack'", intent: "app.launch" },
      { step: 2, instruction: "I'll find and launch the app for you", instructionVi: "Tôi sẽ tìm và mở app đó cho bạn", intent: "app.launch" },
    ],
  },
  {
    id: "how-to-check-battery",
    title: "How to Check Battery",
    titleVi: "Cách kiểm tra pin",
    steps: [
      { step: 1, instruction: "Say 'check battery' or 'pin còn bao nhiêu'", instructionVi: "Nói 'kiểm tra pin' hoặc 'pin còn bao nhiêu'", intent: "hardware.getBatteryStatus" },
      { step: 2, instruction: "I'll show you the battery percentage and health", instructionVi: "Tôi sẽ cho bạn biết mức pin và tình trạng pin", intent: "hardware.getBatteryStatus" },
    ],
  },
  {
    id: "how-to-set-alarm",
    title: "How to Set an Alarm",
    titleVi: "Cách đặt báo thức",
    steps: [
      { step: 1, instruction: "Say 'set alarm for [time]' or 'đặt báo thức [thời gian]'", instructionVi: "Nói 'đặt báo thức 7 giờ'", intent: "alarm.set" },
      { step: 2, instruction: "I'll set a notification timer for you", instructionVi: "Tôi sẽ đặt thông báo đúng giờ cho bạn", intent: "alarm.set" },
    ],
  },
  {
    id: "how-to-screenshot",
    title: "How to Take Screenshot",
    titleVi: "Cách chụp màn hình",
    steps: [
      { step: 1, instruction: "Say 'screenshot' or 'chụp màn hình'", instructionVi: "Nói 'chụp màn hình' hoặc 'screenshot'", intent: "ui.interaction" },
      { step: 2, instruction: "I'll capture your screen and save it to Desktop", instructionVi: "Tôi sẽ chụp màn hình và lưu vào Desktop", intent: "ui.interaction" },
    ],
  },
];

export function getOnboardingShortcuts(): OnboardingShortcut[] {
  return TOP_SHORTCUTS;
}

export function getOnboardingGuides(): OnboardingGuide[] {
  return GUIDES;
}

export function getShortcutById(id: string): OnboardingShortcut | undefined {
  return TOP_SHORTCUTS.find((s) => s.id === id);
}

export function getShortcutsByCategory(category: OnboardingShortcut["category"]): OnboardingShortcut[] {
  return TOP_SHORTCUTS.filter((s) => s.category === category);
}

export function getGuideById(id: string): OnboardingGuide | undefined {
  return GUIDES.find((g) => g.id === id);
}
