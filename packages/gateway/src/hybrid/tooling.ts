/**
 * Hybrid Tooling Module — Barrel Re-export (UC-D14 through UC-D25).
 *
 * Re-exports all tooling functionality from submodules.
 *
 * @module hybrid/tooling
 */

// Re-export helpers and utilities from tooling-types
export {
  execAsync,
  getClient,
  _client,
  OMNISTATE_DIR,
  ensureDir,
  readJson,
  writeJson,
  generateId,
  askClaude,
} from "./tooling-types.js";

// Re-export all types
export type {
  // UC-D14
  WorkflowTemplate,
  WorkflowTemplateStep,
  TemplateParam,
  WorkflowTemplateConfig,
  WorkflowResult,
  SyncResult,
  // UC-D15
  ErrorContext,
  DebugAnalysis,
  CrashAnalysis,
  FixSuggestion,
  FixResult,
  DebugReport,
  // UC-D16
  FileClassification,
  DirectoryClassification,
  OrganizationRules,
  OrganizationResult,
  OrganizationPlan,
  // UC-D17
  HealthReportDoc,
  HealthReportSection,
  ReportConfig,
  ScheduledReport,
  // UC-D18
  MachineSnapshot,
  MachineDiff,
  EnvDiff,
  // UC-D19
  TimelineEvent,
  IncidentTimeline,
  RootCauseAnalysis,
  // UC-D20
  Extension,
  Plugin,
  ShellPlugin,
  // UC-D21
  PipelineConfig,
  PipelineStep,
  Pipeline,
  PipelineResult,
  // UC-D22
  CompliancePolicy,
  ComplianceReport,
  CompliancePolicyResult,
  EncryptionStatus,
  PolicyResult,
  // UC-D23
  Notification,
  NotificationDigest,
  NotificationGroup,
  PrioritizedNotification,
  // UC-D24
  DocResult,
  // UC-D25
  UsageDataPoint,
  ForecastResult,
} from "./tooling-types.js";

// Re-export constants
export { FILE_CATEGORY_MAP, DEFAULT_POLICIES, BUILT_IN_TEMPLATES } from "./tooling-types.js";

// Re-export from tooling-docker (UC-D14, UC-D21)
export {
  listWorkflowTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  runTemplate,
  shareTemplate,
  importTemplate,
  createPipeline,
  runPipeline,
  listPipelines,
  deletePipeline,
} from "./tooling-docker.js";

// Re-export from tooling-git (UC-D16, UC-D18)
export {
  categorizeByExtension,
  classifyFile,
  classifyDirectory,
  organizeDirectory,
  suggestOrganization,
  tagFile,
  getFileTags,
  snapshotMachine,
  diffMachines,
  diffEnvironments,
} from "./tooling-git.js";

// Re-export from tooling-build (UC-D15, D17, D19, D20, D22, D23, D24, D25)
export {
  analyzeError,
  analyzeCrashLog,
  suggestFix,
  autoFix,
  debugProcess,
  generateHealthReport,
  scheduleReport,
  cancelScheduledReport,
  listScheduledReports,
  sendReport,
  collectEvents,
  buildTimeline,
  findRootCause,
  listBrowserExtensions,
  listIDEPlugins,
  listShellPlugins,
  installExtension,
  removeExtension,
  syncExtensions,
  runComplianceCheck,
  getDefaultPolicies,
  checkEncryption,
  checkFirewallPolicy,
  checkPasswordPolicy,
  collectNotifications,
  generateDigest,
  prioritizeNotifications,
  lookupDocs,
  searchManPages,
  fetchOnlineDocs,
  getHistoricalUsage,
  forecastUsage,
  predictDiskFull,
  predictMemoryExhaustion,
} from "./tooling-build.js";
