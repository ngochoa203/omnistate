import type { TriggerCondition, TriggerAction } from "./trigger-engine.js";

export interface RoutineTemplate {
  id: string;
  name: string;       // VN
  nameEn: string;
  description: string;
  icon: string;       // emoji
  trigger: {
    name: string;
    description: string;
    condition: TriggerCondition;
    action: TriggerAction;
    enabled: boolean;
    cooldownMs: number;
  };
}

export const DAILY_ROUTINES: RoutineTemplate[] = [
  {
    id: "morning-briefing",
    name: "Buổi sáng tốt lành",
    nameEn: "Good Morning Briefing",
    description: "Đọc tóm tắt thời tiết, lịch và tin tức lúc 7 giờ sáng",
    icon: "🌅",
    trigger: {
      name: "Buổi sáng tốt lành",
      description: "Đọc tóm tắt thời tiết hôm nay, lịch hôm nay, và 3 tin báo quan trọng",
      condition: { type: "cron", config: { expression: "0 7 * * *" } },
      action: { type: "execute_task", goal: "Đọc tóm tắt thời tiết hôm nay, lịch hôm nay, và 3 tin báo quan trọng", layer: "auto" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "drink-water-noon",
    name: "Nhắc uống nước trưa",
    nameEn: "Drink Water Reminder",
    description: "Nhắc uống nước lúc 12 giờ trưa",
    icon: "💧",
    trigger: {
      name: "Nhắc uống nước trưa",
      description: "Nhắc tôi uống nước",
      condition: { type: "cron", config: { expression: "0 12 * * *" } },
      action: { type: "execute_task", goal: "Nhắc tôi uống nước", layer: "surface" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "bedtime",
    name: "Đi ngủ",
    nameEn: "Bedtime Routine",
    description: "Bật Do Not Disturb, tắt thông báo, mờ màn hình lúc 22 giờ",
    icon: "🌙",
    trigger: {
      name: "Đi ngủ",
      description: "Bật Do Not Disturb, tắt thông báo, mờ màn hình",
      condition: { type: "cron", config: { expression: "0 22 * * *" } },
      action: { type: "execute_task", goal: "Bật Do Not Disturb, tắt thông báo, mờ màn hình", layer: "deep" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "start-work",
    name: "Bắt đầu làm việc",
    nameEn: "Start Work",
    description: "Mở Slack, Mail, Calendar lúc 9 giờ ngày thường",
    icon: "💼",
    trigger: {
      name: "Bắt đầu làm việc",
      description: "Mở Slack, Mail, Calendar",
      condition: { type: "cron", config: { expression: "0 9 * * 1-5" } },
      action: { type: "execute_task", goal: "Mở Slack, Mail, Calendar", layer: "surface" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "end-work",
    name: "Kết thúc làm việc",
    nameEn: "End Work",
    description: "Đóng Slack, lưu tab Safari, hiện báo cáo ngày lúc 18 giờ ngày thường",
    icon: "🏁",
    trigger: {
      name: "Kết thúc làm việc",
      description: "Đóng Slack, lưu tab Safari, hiện báo cáo ngày",
      condition: { type: "cron", config: { expression: "0 18 * * 1-5" } },
      action: { type: "execute_task", goal: "Đóng Slack, lưu tab Safari, hiện báo cáo ngày", layer: "surface" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "weekend-relax",
    name: "Cuối tuần thư giãn",
    nameEn: "Weekend Relaxation",
    description: "Mở Spotify playlist và Apple TV sáng thứ Bảy",
    icon: "🎵",
    trigger: {
      name: "Cuối tuần thư giãn",
      description: "Mở Spotify playlist Cuối tuần, mở Apple TV",
      condition: { type: "cron", config: { expression: "0 10 * * 6" } },
      action: { type: "execute_task", goal: "Mở Spotify playlist Cuối tuần, mở Apple TV", layer: "surface" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "health-check-machine",
    name: "Kiểm tra sức khoẻ máy",
    nameEn: "Machine Health Check",
    description: "Hiện CPU, RAM, dung lượng đĩa và chạy maintenance tối Chủ nhật",
    icon: "🖥️",
    trigger: {
      name: "Kiểm tra sức khoẻ máy",
      description: "Hiện CPU, RAM, dung lượng đĩa, chạy maintenance",
      condition: { type: "cron", config: { expression: "0 20 * * 0" } },
      action: { type: "execute_task", goal: "Hiện CPU, RAM, dung lượng đĩa, chạy maintenance", layer: "auto" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
  {
    id: "cpu-alert",
    name: "Cảnh báo CPU cao",
    nameEn: "High CPU Alert",
    description: "Cảnh báo khi CPU vượt 85%",
    icon: "🔥",
    trigger: {
      name: "Cảnh báo CPU cao",
      description: "Cảnh báo và liệt kê top 5 process tốn CPU",
      condition: { type: "cpu_threshold", config: { operator: "gt", value: 85 } },
      action: { type: "execute_task", goal: "Cảnh báo và liệt kê top 5 process tốn CPU", layer: "auto" },
      enabled: true,
      cooldownMs: 300_000,
    },
  },
  {
    id: "ram-alert",
    name: "Cảnh báo RAM gần đầy",
    nameEn: "High RAM Alert",
    description: "Cảnh báo khi RAM vượt 90%",
    icon: "⚠️",
    trigger: {
      name: "Cảnh báo RAM gần đầy",
      description: "Đóng app không dùng và liệt kê app đang chạy",
      condition: { type: "memory_threshold", config: { operator: "gt", value: 90, unit: "percent" } },
      action: { type: "execute_task", goal: "Đóng app không dùng và liệt kê app đang chạy", layer: "auto" },
      enabled: true,
      cooldownMs: 300_000,
    },
  },
  {
    id: "evening-backup",
    name: "Tự động backup buổi tối",
    nameEn: "Evening Auto Backup",
    description: "Backup ~/Documents lên iCloud lúc 23 giờ",
    icon: "☁️",
    trigger: {
      name: "Tự động backup buổi tối",
      description: "Backup ~/Documents lên iCloud",
      condition: { type: "cron", config: { expression: "0 23 * * *" } },
      action: { type: "execute_task", goal: "Backup ~/Documents lên iCloud", layer: "auto" },
      enabled: true,
      cooldownMs: 3_600_000,
    },
  },
];
