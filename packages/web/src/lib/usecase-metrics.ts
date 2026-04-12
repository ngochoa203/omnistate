import matrixData from "../../../../usecases.matrix.json";

type UseCaseStatus = "implemented" | "partial" | "planned";
export type UCLanguage = "vi" | "en";

interface MatrixItem {
  id: string;
  title: string;
  status: string;
}

interface MatrixGroup {
  id: string;
  name: string;
  items: MatrixItem[];
}

interface MatrixData {
  groups: MatrixGroup[];
}

export interface UseCaseMetrics {
  total: number;
  implemented: number;
  partial: number;
  planned: number;
  implementedPct: number;
}

export interface UseCaseSummaryItem {
  id: string;
  name: string;
  status: UseCaseStatus;
}

type StatusUI = {
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
};

const STATUS_COLORS: Record<UseCaseStatus, Omit<StatusUI, "label">> = {
  implemented: {
    shortLabel: "✅",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.1)",
    border: "rgba(34,197,94,0.25)",
    dot: "#22c55e",
  },
  partial: {
    shortLabel: "⚠️",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.1)",
    border: "rgba(245,158,11,0.25)",
    dot: "#f59e0b",
  },
  planned: {
    shortLabel: "❌",
    color: "#6366f1",
    bg: "rgba(99,102,241,0.08)",
    border: "rgba(99,102,241,0.18)",
    dot: "#5a5a7a",
  },
};

const STATUS_LABELS: Record<UCLanguage, Record<UseCaseStatus, string>> = {
  vi: {
    implemented: "Đã triển khai",
    partial: "Một phần",
    planned: "Kế hoạch",
  },
  en: {
    implemented: "Implemented",
    partial: "Partial",
    planned: "Planned",
  },
};

export interface UseCaseCopy {
  sectionTitle: string;
  progressTitle: string;
  implementationProgress: string;
  implementedPercentLabel: string;
  useCasesUnit: string;
}

export function getUseCaseCopy(language: UCLanguage): UseCaseCopy {
  if (language === "en") {
    return {
      sectionTitle: "Use Case Coverage",
      progressTitle: "Implementation Progress",
      implementationProgress: "implemented",
      implementedPercentLabel: "implemented",
      useCasesUnit: "use cases",
    };
  }

  return {
    sectionTitle: "Độ phủ Use Case",
    progressTitle: "Tiến độ triển khai",
    implementationProgress: "đã triển khai",
    implementedPercentLabel: "đã triển khai",
    useCasesUnit: "use case",
  };
}

export function getStatusUI(language: UCLanguage): Record<UseCaseStatus, StatusUI> {
  return {
    implemented: {
      ...STATUS_COLORS.implemented,
      label: STATUS_LABELS[language].implemented,
    },
    partial: {
      ...STATUS_COLORS.partial,
      label: STATUS_LABELS[language].partial,
    },
    planned: {
      ...STATUS_COLORS.planned,
      label: STATUS_LABELS[language].planned,
    },
  };
}

function normalizeStatus(status: string): UseCaseStatus {
  if (status === "implemented") return "implemented";
  if (status === "partial") return "partial";
  return "planned";
}

function flattenUseCases(data: MatrixData): UseCaseSummaryItem[] {
  return data.groups.flatMap((group) =>
    group.items.map((item) => ({
      id: item.id,
      name: item.title,
      status: normalizeStatus(item.status),
    })),
  );
}

const allUseCases = flattenUseCases(matrixData as MatrixData);

export function getUseCaseMetrics(): UseCaseMetrics {
  const implemented = allUseCases.filter((item) => item.status === "implemented").length;
  const partial = allUseCases.filter((item) => item.status === "partial").length;
  const planned = allUseCases.filter((item) => item.status === "planned").length;
  const total = allUseCases.length;

  return {
    total,
    implemented,
    partial,
    planned,
    implementedPct: total > 0 ? Math.round((implemented / total) * 100) : 0,
  };
}

export function getUseCaseHighlights(limit = 8): UseCaseSummaryItem[] {
  const statusWeight: Record<UseCaseStatus, number> = {
    implemented: 0,
    partial: 1,
    planned: 2,
  };

  return [...allUseCases]
    .sort((a, b) => {
      const byStatus = statusWeight[a.status] - statusWeight[b.status];
      if (byStatus !== 0) return byStatus;
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" });
    })
    .slice(0, limit);
}

export function getUseCaseProgressSegments(metrics: UseCaseMetrics) {
  const statusUi = getStatusUI("vi");
  const implementedWidth = metrics.total > 0 ? (metrics.implemented / metrics.total) * 100 : 0;
  const partialWidth = metrics.total > 0 ? (metrics.partial / metrics.total) * 100 : 0;
  const plannedWidth = Math.max(0, 100 - implementedWidth - partialWidth);

  return {
    implementedWidth,
    partialWidth,
    plannedWidth,
    gradient: `linear-gradient(90deg, ${statusUi.implemented.color} 0%, ${statusUi.implemented.color} ${implementedWidth}%, ${statusUi.partial.color} ${implementedWidth}%, ${statusUi.partial.color} ${implementedWidth + partialWidth}%, ${statusUi.planned.color} ${implementedWidth + partialWidth}%, ${statusUi.planned.color} ${implementedWidth + partialWidth + plannedWidth}%)`,
  };
}