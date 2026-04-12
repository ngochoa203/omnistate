import { execSync } from "node:child_process";

export interface ResourceChange {
  type: "file" | "process" | "system";
  action: "created" | "modified" | "deleted" | "started" | "stopped" | "changed";
  path?: string;
  pid?: number;
  name?: string;
  timestamp: string;
}

export interface ResourceImpactReport {
  taskId: string;
  changes: ResourceChange[];
  summary: string;
  generatedAt: string;
}

interface ProcessSnapshot {
  pid: number;
  name: string;
  command: string;
}

export class ResourceTracker {
  private processSnapshotBefore: ProcessSnapshot[] = [];
  private taskId: string;
  private changes: ResourceChange[] = [];

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  /** Call before task execution to snapshot current state */
  snapshotBefore(): void {
    this.processSnapshotBefore = this.getProcessList();
  }

  /** Record a file change during execution */
  recordFileChange(action: ResourceChange["action"], path: string): void {
    this.changes.push({
      type: "file",
      action,
      path,
      timestamp: new Date().toISOString(),
    });
  }

  /** Record a system change */
  recordSystemChange(action: string, name: string): void {
    this.changes.push({
      type: "system",
      action: action as ResourceChange["action"],
      name,
      timestamp: new Date().toISOString(),
    });
  }

  /** Call after task execution to diff and generate report */
  generateReport(userLanguage: string = "en"): ResourceImpactReport {
    // Diff processes
    const processesAfter = this.getProcessList();
    const beforePids = new Set(this.processSnapshotBefore.map(p => p.pid));
    const afterPids = new Set(processesAfter.map(p => p.pid));

    for (const proc of processesAfter) {
      if (!beforePids.has(proc.pid)) {
        this.changes.push({
          type: "process",
          action: "started",
          pid: proc.pid,
          name: proc.name,
          timestamp: new Date().toISOString(),
        });
      }
    }

    for (const proc of this.processSnapshotBefore) {
      if (!afterPids.has(proc.pid)) {
        this.changes.push({
          type: "process",
          action: "stopped",
          pid: proc.pid,
          name: proc.name,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const summary = this.generateSummary(userLanguage);

    return {
      taskId: this.taskId,
      changes: this.changes,
      summary,
      generatedAt: new Date().toISOString(),
    };
  }

  private getProcessList(): ProcessSnapshot[] {
    try {
      const output = execSync("ps -eo pid,comm --no-headers 2>/dev/null || ps -eo pid,comm", {
        encoding: "utf-8",
        timeout: 5000,
      });
      return output.trim().split("\n").map(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0]);
        const name = parts.slice(1).join(" ");
        return { pid, name, command: name };
      }).filter(p => !isNaN(p.pid));
    } catch {
      return [];
    }
  }

  private generateSummary(lang: string): string {
    const fileChanges = this.changes.filter(c => c.type === "file");
    const processChanges = this.changes.filter(c => c.type === "process");
    const systemChanges = this.changes.filter(c => c.type === "system");

    const counts = {
      filesCreated: fileChanges.filter(c => c.action === "created").length,
      filesModified: fileChanges.filter(c => c.action === "modified").length,
      filesDeleted: fileChanges.filter(c => c.action === "deleted").length,
      processesStarted: processChanges.filter(c => c.action === "started").length,
      processesStopped: processChanges.filter(c => c.action === "stopped").length,
      systemChanges: systemChanges.length,
    };

    // Generate summary in user's language
    const summaries: Record<string, (c: typeof counts) => string> = {
      en: (c) => {
        const parts: string[] = [];
        if (c.filesCreated) parts.push(`${c.filesCreated} file(s) created`);
        if (c.filesModified) parts.push(`${c.filesModified} file(s) modified`);
        if (c.filesDeleted) parts.push(`${c.filesDeleted} file(s) deleted`);
        if (c.processesStarted) parts.push(`${c.processesStarted} process(es) started`);
        if (c.processesStopped) parts.push(`${c.processesStopped} process(es) stopped`);
        if (c.systemChanges) parts.push(`${c.systemChanges} system change(s)`);
        return parts.length ? `Resource impact: ${parts.join(", ")}` : "No resource changes detected";
      },
      vi: (c) => {
        const parts: string[] = [];
        if (c.filesCreated) parts.push(`${c.filesCreated} tệp được tạo`);
        if (c.filesModified) parts.push(`${c.filesModified} tệp được chỉnh sửa`);
        if (c.filesDeleted) parts.push(`${c.filesDeleted} tệp bị xóa`);
        if (c.processesStarted) parts.push(`${c.processesStarted} tiến trình được khởi động`);
        if (c.processesStopped) parts.push(`${c.processesStopped} tiến trình bị dừng`);
        if (c.systemChanges) parts.push(`${c.systemChanges} thay đổi hệ thống`);
        return parts.length ? `Tác động tài nguyên: ${parts.join(", ")}` : "Không phát hiện thay đổi tài nguyên";
      },
      ja: (c) => {
        const parts: string[] = [];
        if (c.filesCreated) parts.push(`${c.filesCreated}ファイル作成`);
        if (c.filesModified) parts.push(`${c.filesModified}ファイル変更`);
        if (c.filesDeleted) parts.push(`${c.filesDeleted}ファイル削除`);
        if (c.processesStarted) parts.push(`${c.processesStarted}プロセス開始`);
        if (c.processesStopped) parts.push(`${c.processesStopped}プロセス停止`);
        return parts.length ? `リソース影響: ${parts.join("、")}` : "リソース変更なし";
      },
      ko: (c) => {
        const parts: string[] = [];
        if (c.filesCreated) parts.push(`파일 ${c.filesCreated}개 생성`);
        if (c.filesModified) parts.push(`파일 ${c.filesModified}개 수정`);
        if (c.filesDeleted) parts.push(`파일 ${c.filesDeleted}개 삭제`);
        if (c.processesStarted) parts.push(`프로세스 ${c.processesStarted}개 시작`);
        if (c.processesStopped) parts.push(`프로세스 ${c.processesStopped}개 중지`);
        return parts.length ? `리소스 영향: ${parts.join(", ")}` : "리소스 변경 없음";
      },
      zh: (c) => {
        const parts: string[] = [];
        if (c.filesCreated) parts.push(`创建了${c.filesCreated}个文件`);
        if (c.filesModified) parts.push(`修改了${c.filesModified}个文件`);
        if (c.filesDeleted) parts.push(`删除了${c.filesDeleted}个文件`);
        if (c.processesStarted) parts.push(`启动了${c.processesStarted}个进程`);
        if (c.processesStopped) parts.push(`停止了${c.processesStopped}个进程`);
        return parts.length ? `资源影响：${parts.join("，")}` : "未检测到资源变更";
      },
    };

    const gen = summaries[lang] || summaries.en;
    return gen(counts);
  }
}
