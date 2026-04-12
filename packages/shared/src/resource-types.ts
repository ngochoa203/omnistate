export interface ResourceChange {
  type: "file" | "process" | "system";
  action: "created" | "modified" | "deleted" | "started" | "stopped" | "changed";
  path?: string;
  pid?: number;
  name?: string;
  before?: string;
  after?: string;
  timestamp: string;
}

export interface ResourceImpactReport {
  taskId: string;
  changes: ResourceChange[];
  summary: string;
  generatedAt: string;
}
