export type AppLanguage = "en" | "vi" | "ja" | "ko" | "zh" | "fr" | "de" | "es" | "th";

export const SUPPORTED_LANGUAGES: { code: AppLanguage; name: string; nativeName: string; flag: string }[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇺🇸" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "th", name: "Thai", nativeName: "ภาษาไทย", flag: "🇹🇭" },
];

/** Minimal mobile copy — covers common actions */
export interface MobileCopy {
  nav: {
    connect: string;
    dashboard: string;
    chat: string;
    voice: string;
    settings: string;
    triggers: string;
  };
  status: {
    connected: string;
    connecting: string;
    disconnected: string;
    error: string;
  };
  common: {
    send: string;
    cancel: string;
    retry: string;
    save: string;
    delete: string;
    confirm: string;
    loading: string;
  };
  connect: {
    title: string;
    scanning: string;
    noGateway: string;
    manualEntry: string;
    enterIp: string;
    enterPin: string;
    pair: string;
    paired: string;
    pairFailed: string;
  };
  voice: {
    enrollTitle: string;
    enrollDesc: string;
    recording: string;
    tapToRecord: string;
    sample: string;
    of: string;
    verifying: string;
    verified: string;
    notVerified: string;
  };
  chat: {
    placeholder: string;
    thinking: string;
    taskComplete: string;
    taskError: string;
  };
}

const EN: MobileCopy = {
  nav: { connect: "Connect", dashboard: "Dashboard", chat: "Chat", voice: "Voice", settings: "Settings", triggers: "Triggers" },
  status: { connected: "Connected", connecting: "Connecting...", disconnected: "Disconnected", error: "Connection Error" },
  common: { send: "Send", cancel: "Cancel", retry: "Retry", save: "Save", delete: "Delete", confirm: "Confirm", loading: "Loading..." },
  connect: { title: "Connect to OmniState", scanning: "Scanning network...", noGateway: "No gateway found", manualEntry: "Enter manually", enterIp: "Gateway IP address", enterPin: "Enter PIN from Mac", pair: "Pair", paired: "Paired successfully!", pairFailed: "Pairing failed" },
  voice: { enrollTitle: "Voice Enrollment", enrollDesc: "Record 3 voice samples to set up your voice profile", recording: "Recording...", tapToRecord: "Tap to record", sample: "Sample", of: "of", verifying: "Verifying...", verified: "Voice verified!", notVerified: "Voice not recognized" },
  chat: { placeholder: "What would you like to do?", thinking: "Thinking...", taskComplete: "Task completed", taskError: "Task failed" },
};

const VI: MobileCopy = {
  nav: { connect: "Kết nối", dashboard: "Tổng quan", chat: "Trò chuyện", voice: "Giọng nói", settings: "Cài đặt", triggers: "Kích hoạt" },
  status: { connected: "Đã kết nối", connecting: "Đang kết nối...", disconnected: "Mất kết nối", error: "Lỗi kết nối" },
  common: { send: "Gửi", cancel: "Hủy", retry: "Thử lại", save: "Lưu", delete: "Xóa", confirm: "Xác nhận", loading: "Đang tải..." },
  connect: { title: "Kết nối OmniState", scanning: "Đang quét mạng...", noGateway: "Không tìm thấy gateway", manualEntry: "Nhập thủ công", enterIp: "Địa chỉ IP gateway", enterPin: "Nhập PIN từ Mac", pair: "Ghép nối", paired: "Ghép nối thành công!", pairFailed: "Ghép nối thất bại" },
  voice: { enrollTitle: "Đăng ký giọng nói", enrollDesc: "Ghi 3 mẫu giọng nói để thiết lập hồ sơ", recording: "Đang ghi...", tapToRecord: "Nhấn để ghi", sample: "Mẫu", of: "trên", verifying: "Đang xác minh...", verified: "Giọng nói đã xác minh!", notVerified: "Không nhận dạng được" },
  chat: { placeholder: "Bạn muốn làm gì?", thinking: "Đang suy nghĩ...", taskComplete: "Hoàn thành", taskError: "Thất bại" },
};

const translations: Record<AppLanguage, MobileCopy> = {
  en: EN,
  vi: VI,
  ja: EN, // fallback to EN for now
  ko: EN,
  zh: EN,
  fr: EN,
  de: EN,
  es: EN,
  th: EN,
};

export function getCopy(lang: AppLanguage = "en"): MobileCopy {
  return translations[lang] ?? EN;
}
