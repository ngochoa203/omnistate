export type AppLanguage = "vi" | "en";

const COPY = {
  vi: {
    nav: {
      dashboard: "Tổng quan",
      chat: "AI Chat",
      voice: "Voice",
      health: "Theo dõi hệ thống",
      system: "Thông tin máy",
      settings: "Cài đặt",
      config: "OmniState Config",
      screenTree: "Cây màn hình",
    },
    status: {
      live: "Trực tuyến",
      connecting: "Đang kết nối",
      offline: "Ngoại tuyến",
      unchecked: "Chưa kiểm tra",
      ready: "Sẵn sàng",
      error: "Lỗi",
      gateway: "Gateway",
      llmApi: "LLM API",
    },
    common: {
      clear: "Xoá",
      viewAll: "Xem tất cả →",
      startTask: "Bắt đầu →",
      recentTasks: "Tác vụ gần đây",
      noTasks: "Chưa có tác vụ.",
      messages: "tin nhắn",
      executing: "đang chạy",
    },
    chat: {
      placeholder: "Điều khiển máy bằng ngôn ngữ tự nhiên...",
      hint: "Enter để gửi · Shift+Enter xuống dòng",
      emptyTitle: "OmniState",
      emptyDesc: "Điều khiển máy bằng ngôn ngữ tự nhiên. Hỏi bất kỳ tác vụ nào từ kiểm tra log đến workflow nhiều bước.",
      gatewayOffline: "Gateway chưa kết nối - hãy khởi động daemon trước",
      newConversation: "+ Phiên mới",
      conversations: "Phiên chat",
      rename: "Đổi tên",
      delete: "Xoá",
    },
    dashboard: {
      quickOps: "Tác vụ nhanh",
      run: "Chạy",
      openVoice: "Mở Voice",
    },
  },
  en: {
    nav: {
      dashboard: "Dashboard",
      chat: "AI Chat",
      voice: "Voice",
      health: "Health Monitor",
      system: "System Info",
      settings: "Settings",
      config: "OmniState Config",
      screenTree: "Screen Tree",
    },
    status: {
      live: "Live",
      connecting: "Connecting",
      offline: "Offline",
      unchecked: "Unchecked",
      ready: "Ready",
      error: "Error",
      gateway: "Gateway",
      llmApi: "LLM API",
    },
    common: {
      clear: "Clear",
      viewAll: "View all →",
      startTask: "Start one →",
      recentTasks: "Recent Tasks",
      noTasks: "No tasks yet.",
      messages: "messages",
      executing: "executing",
    },
    chat: {
      placeholder: "Control your Mac with natural language...",
      hint: "Enter to send · Shift+Enter for newline",
      emptyTitle: "OmniState",
      emptyDesc: "Control your Mac with natural language. Ask anything from log checks to multi-step workflows.",
      gatewayOffline: "Gateway not connected - start the daemon first",
      newConversation: "+ New conversation",
      conversations: "Conversations",
      rename: "Rename",
      delete: "Delete",
    },
    dashboard: {
      quickOps: "Quick Ops",
      run: "Run",
      openVoice: "Open Voice",
    },
  },
} as const;

export function getCopy(lang: AppLanguage) {
  return COPY[lang];
}
