/**
 * OmniState Tool Layers Index
 *
 * Total: 80 tool layers with 1000+ tools
 * Organized by functional category
 *
 * Usage:
 *   import * as layers from "./layers/index.js";
 *   import { OSHardwareLayer } from "./layers/index.js";
 *   import { BrowserAdvancedTools } from "./layers/index.js";
 *
 * Note: Advanced layers (GROUP 51-80) use namespace aliases to avoid
 * duplicate export conflicts with base layers.
 */

// ===================================================================
// Core System (GROUP 1-6) — primary exports
// ===================================================================
export * from "./os-hardware-tools.js";
export * from "./app-management-tools.js";
export * from "./browser-tools.js";
export * from "./file-tools.js";
export * from "./dev-tools.js";
export * from "./chaining-workflows.js";

// ===================================================================
// Productivity & Workspace (GROUP 7-12)
// ===================================================================
export * from "./smart-home-tools.js";
export * from "./workspace-tools.js";
export * from "./notification-tools.js";
export * from "./screenshot-tools.js";

// text-tools.js — getClipboard/setClipboard exist in clipboard-tools too (primary source)
export * as TextTools from "./text-tools.js";

// calendar-tools.js
export * from "./calendar-tools.js";

// ===================================================================
// Media & System (GROUP 13-18)
// ===================================================================

// media-player-tools.js — spotifyPlay/spotifyPause exist in app-management too (primary source)
export * as MediaPlayerTools from "./media-player-tools.js";

export * from "./system-monitor-tools.js";
export * from "./quick-action-tools.js";
export * from "./communication-tools.js";
export * from "./window-display-tools.js";
export * from "./security-privacy-tools.js";

// ===================================================================
// Development & Data (GROUP 19-24)
// ===================================================================

// terminal-tools.js — getEnvVar/setEnvVar exist elsewhere (primary source)
export * as TerminalTools from "./terminal-tools.js";

export * from "./automation-tools.js";
export * from "./backup-sync-tools.js";
export * from "./database-tools.js";
export * from "./git-tools.js";
export * from "./api-web-tools.js";

// ===================================================================
// Specialized Tools (GROUP 25-30)
// ===================================================================

// image-media-tools.js
export * from "./image-media-tools.js";

// clipboard-tools.js — primary source for getClipboard/setClipboard
export * from "./clipboard-tools.js";

// finder-spotlight-tools.js — closeAllFinderWindows exists in app-management (primary)
export * as FinderTools from "./finder-spotlight-tools.js";

export * from "./process-performance-tools.js";
export * from "./network-connectivity-tools.js";
// datetime-scheduling-tools.js — startPomodoro exists in workspace-tools (primary)
export * as DateTimeTools from "./datetime-scheduling-tools.js";

// ===================================================================
// System & AI (GROUP 31-36)
// ===================================================================
// system-preferences-tools.js — setLowPowerMode exists in process-performance-tools (primary)
export * as SystemPrefsTools from "./system-preferences-tools.js";
export * from "./ai-llm-tools.js";

// ===================================================================
// DevOps & Cloud (GROUP 37-42)
// ===================================================================

// docker-container-tools.js — isDockerRunning exists in dev-tools (primary)
export * as DockerTools from "./docker-container-tools.js";

// kubernetes-tools.js — rollbackDeployment exists in deployment-server (primary)
export * as KubernetesTools from "./kubernetes-tools.js";

// cicd-pipeline-tools.js — listWorkflows exists in automation (primary)
export * as CICDTools from "./cicd-pipeline-tools.js";

export * from "./cloud-provider-tools.js";
export * from "./api-docs-tools.js";
export * from "./testing-qa-tools.js";

// ===================================================================
// Infrastructure & Monitoring (GROUP 43-48)
// ===================================================================
export * from "./logging-monitoring-tools.js";
export * from "./secrets-config-tools.js";
export * from "./code-quality-tools.js";
export * from "./deployment-server-tools.js";
export * from "./notification-channels-tools.js";
export * from "./virtualization-vm-tools.js";

// ===================================================================
// Security & Identity (GROUP 49-50)
// ===================================================================
export * from "./ssh-remote-tools.js";
export * from "./auth-identity-tools.js";

// ===================================================================
// Layer Class Exports (all 50)
// ===================================================================
export { OSHardwareLayer } from "./os-hardware-tools.js";
export { AppManagementLayer } from "./app-management-tools.js";
export { BrowserLayer } from "./browser-tools.js";
export { FileLayer } from "./file-tools.js";
export { DevLayer } from "./dev-tools.js";
export { ChainingLayer } from "./chaining-workflows.js";
export { SmartHomeLayer } from "./smart-home-tools.js";
export { WorkspaceLayer } from "./workspace-tools.js";
export { NotificationLayer } from "./notification-tools.js";
export { ScreenshotLayer } from "./screenshot-tools.js";
export { TextLayer } from "./text-tools.js";
export { CalendarLayer } from "./calendar-tools.js";
export { MediaPlayerLayer } from "./media-player-tools.js";
export { SystemMonitorLayer } from "./system-monitor-tools.js";
export { QuickActionLayer } from "./quick-action-tools.js";
export { CommunicationLayer } from "./communication-tools.js";
export { WindowDisplayLayer } from "./window-display-tools.js";
export { SecurityLayer } from "./security-privacy-tools.js";
export { TerminalLayer } from "./terminal-tools.js";
export { AutomationLayer } from "./automation-tools.js";
export { BackupSyncLayer } from "./backup-sync-tools.js";
export { DatabaseLayer } from "./database-tools.js";
export { GitLayer } from "./git-tools.js";
export { ApiWebLayer } from "./api-web-tools.js";
export { ImageMediaLayer } from "./image-media-tools.js";
export { ClipboardLayer } from "./clipboard-tools.js";
export { FinderSpotlightLayer } from "./finder-spotlight-tools.js";
export { ProcessPerformanceLayer } from "./process-performance-tools.js";
export { NetworkLayer } from "./network-connectivity-tools.js";
export { DateTimeLayer } from "./datetime-scheduling-tools.js";
export { SystemPrefsLayer } from "./system-preferences-tools.js";
export { AILLMTools } from "./ai-llm-tools.js";
export { DockerLayer } from "./docker-container-tools.js";
export { KubernetesLayer } from "./kubernetes-tools.js";
export { CICDLayer } from "./cicd-pipeline-tools.js";
export { CloudProviderLayer } from "./cloud-provider-tools.js";
export { APIDocsLayer } from "./api-docs-tools.js";
export { TestingLayer } from "./testing-qa-tools.js";
export { LoggingLayer } from "./logging-monitoring-tools.js";
export { SecretsLayer } from "./secrets-config-tools.js";
export { CodeQualityLayer } from "./code-quality-tools.js";
export { DeploymentLayer } from "./deployment-server-tools.js";
export { NotificationChannelsLayer } from "./notification-channels-tools.js";
export { VirtualizationLayer } from "./virtualization-vm-tools.js";
export { SSHRemoteLayer } from "./ssh-remote-tools.js";
export { AuthIdentityLayer } from "./auth-identity-tools.js";

// ===================================================================
// Advanced Layer Exports (GROUP 51-80) — namespace aliases to avoid conflicts
// ===================================================================

// Browser Advanced
export * as BrowserAdvancedTools from "./browser-advanced-tools.js";

// File Advanced
export * as FileAdvancedTools from "./file-advanced-tools.js";

// System Automation
export * as SystemAutomationTools from "./system-automation-tools.js";

// Git Advanced
export * as GitAdvancedTools from "./git-advanced-tools.js";

// Database Advanced
export * as DatabaseAdvancedTools from "./database-advanced-tools.js";

// API Advanced
export * as APIAdvancedTools from "./api-advanced-tools.js";

// Docker Advanced
export * as DockerAdvancedTools from "./docker-advanced-tools.js";

// Kubernetes Advanced
export * as KubernetesAdvancedTools from "./kubernetes-advanced-tools.js";

// AWS Advanced
export * as AWSAdvancedTools from "./aws-advanced-tools.js";

// GCP & Azure Advanced
export * as GCPAzureAdvancedTools from "./gcp-azure-advanced-tools.js";

// Monitoring Advanced
export * as MonitoringAdvancedTools from "./monitoring-advanced-tools.js";

// Security Advanced
export * as SecurityAdvancedTools from "./security-advanced-tools.js";

// DevOps Advanced
export * as DevOpsAdvancedTools from "./devops-advanced-tools.js";

// Networking Advanced
export * as NetworkingAdvancedTools from "./networking-advanced-tools.js";

// Testing Advanced
export * as TestingAdvancedTools from "./testing-advanced-tools.js";

// Mobile Development
export * as MobileDevTools from "./mobile-dev-tools.js";

// Cloud Native
export * as CloudNativeTools from "./cloud-native-tools.js";

// Data Pipeline
export * as DataPipelineTools from "./data-pipeline-tools.js";

// Observability
export * as ObservabilityTools from "./observability-tools.js";

// Productivity Advanced
export * as ProductivityAdvancedTools from "./productivity-advanced-tools.js";

// Code Analysis
export * as CodeAnalysisTools from "./code-analysis-tools.js";

// Containerization
export * as ContainerizationTools from "./containerization-tools.js";

// AI Integration
export * as AIIntegrationTools from "./ai-integration-tools.js";

// Media Processing
export * as MediaProcessingTools from "./media-processing-tools.js";

// System Maintenance
export * as SystemMaintenanceTools from "./system-maintenance-tools.js";

// Documentation
export * as DocumentationTools from "./documentation-tools.js";

// Backup & Restore
export * as BackupRestoreTools from "./backup-restore-tools.js";

// Terminal Advanced
export * as TerminalAdvancedTools from "./terminal-advanced-tools.js";

// Version Control Advanced
export * as VersionControlAdvancedTools from "./version-control-advanced-tools.js";

// Collaboration
export * as CollaborationTools from "./collaboration-tools.js";

// ===================================================================
// Advanced Layer Classes
// ===================================================================
export { BrowserAdvancedLayer } from "./browser-advanced-tools.js";
export { FileAdvancedLayer } from "./file-advanced-tools.js";
export { SystemAutomationLayer } from "./system-automation-tools.js";
export { GitAdvancedLayer } from "./git-advanced-tools.js";
export { DatabaseAdvancedLayer } from "./database-advanced-tools.js";
export { APIAdvancedLayer } from "./api-advanced-tools.js";
export { DockerAdvancedLayer } from "./docker-advanced-tools.js";
export { KubernetesAdvancedLayer } from "./kubernetes-advanced-tools.js";
export { AWSAdvancedLayer } from "./aws-advanced-tools.js";
export { GCPAzureAdvancedLayer } from "./gcp-azure-advanced-tools.js";
export { MonitoringAdvancedLayer } from "./monitoring-advanced-tools.js";
export { SecurityAdvancedLayer } from "./security-advanced-tools.js";
export { DevOpsAdvancedLayer } from "./devops-advanced-tools.js";
export { NetworkingAdvancedLayer } from "./networking-advanced-tools.js";
export { TestingAdvancedLayer } from "./testing-advanced-tools.js";
export { MobileDevLayer } from "./mobile-dev-tools.js";
export { CloudNativeLayer } from "./cloud-native-tools.js";
export { DataPipelineLayer } from "./data-pipeline-tools.js";
export { ObservabilityLayer } from "./observability-tools.js";
export { ProductivityAdvancedLayer } from "./productivity-advanced-tools.js";
export { CodeAnalysisLayer } from "./code-analysis-tools.js";
export { ContainerizationLayer } from "./containerization-tools.js";
export { AIIntegrationLayer } from "./ai-integration-tools.js";
export { MediaProcessingLayer } from "./media-processing-tools.js";
export { SystemMaintenanceLayer } from "./system-maintenance-tools.js";
export { DocumentationLayer } from "./documentation-tools.js";
export { BackupRestoreLayer } from "./backup-restore-tools.js";
export { TerminalAdvancedLayer } from "./terminal-advanced-tools.js";
export { VersionControlAdvancedLayer } from "./version-control-advanced-tools.js";
export { CollaborationLayer } from "./collaboration-tools.js";

// ===================================================================
// Batch 2 Advanced Layers (API 66-95) — 30 more advanced tools
// ===================================================================

// Analytics & Metrics
export * as AnalyticsTools from "./analytics-tools.js";
export * as MetricsCollectionTools from "./metrics-collection-tools.js";
export * as ReportingTools from "./reporting-tools.js";
export * as IntegrationTools from "./integration-tools.js";
export * as BatchProcessingTools from "./batch-processing-tools.js";

// Queue & Events
export * as QueueTools from "./queue-tools.js";
export * as EventDrivenTools from "./event-driven-tools.js";

// State & Config
export * as StateManagementTools from "./state-management-tools.js";
export * as ConfigManagementTools from "./config-management-tools.js";
export * as FeatureFlagsTools from "./feature-flags-tools.js";

// Users & Permissions
export * as UserManagementTools from "./user-management-tools.js";
export * as PermissionsTools from "./permissions-tools.js";
export * as AuditLoggingTools from "./audit-logging-tools.js";

// Data Operations
export * as DataExportTools from "./data-export-tools.js";
export * as SchemaTools from "./schema-tools.js";
export * as ValidationTools from "./validation-tools.js";
export * as TransformationTools from "./transformation-tools.js";
export * as SearchIndexingTools from "./search-indexing-tools.js";
export * as AggregationTools from "./aggregation-tools.js";

// Infrastructure
export * as CacheInvalidationTools from "./cache-invalidation-tools.js";
export * as RateLimitingTools from "./rate-limiting-tools.js";
export * as CircuitBreakerTools from "./circuit-breaker-tools.js";
export * as RetryLogicTools from "./retry-logic-tools.js";
export * as TimeoutManagementTools from "./timeout-management-tools.js";

// Communication
export * as WebhookTools from "./webhook-tools.js";
export * as SchedulingTools from "./scheduling-tools.js";
export * as NotificationRoutingTools from "./notification-routing-tools.js";

// Advanced Patterns
export * as TemplateTools from "./template-tools.js";
export * as WorkflowOrchestrationTools from "./workflow-orchestration-tools.js";
export * as IdempotencyTools from "./idem-potency-tools.js";

// ===================================================================
// Layer Class Exports (Batch 2)
// ===================================================================
export { AnalyticsLayer } from "./analytics-tools.js";
export { MetricsCollectionLayer } from "./metrics-collection-tools.js";
export { ReportingLayer } from "./reporting-tools.js";
export { IntegrationLayer } from "./integration-tools.js";
export { BatchProcessingLayer } from "./batch-processing-tools.js";
export { QueueLayer } from "./queue-tools.js";
export { EventDrivenLayer } from "./event-driven-tools.js";
export { StateManagementLayer } from "./state-management-tools.js";
export { ConfigManagementLayer } from "./config-management-tools.js";
export { FeatureFlagsLayer } from "./feature-flags-tools.js";
export { UserManagementLayer } from "./user-management-tools.js";
export { PermissionsLayer } from "./permissions-tools.js";
export { AuditLoggingLayer } from "./audit-logging-tools.js";
export { DataExportLayer } from "./data-export-tools.js";
export { SchemaLayer } from "./schema-tools.js";
export { ValidationLayer } from "./validation-tools.js";
export { TransformationLayer } from "./transformation-tools.js";
export { SearchIndexingLayer } from "./search-indexing-tools.js";
export { CacheInvalidationLayer } from "./cache-invalidation-tools.js";
export { RateLimitingLayer } from "./rate-limiting-tools.js";
export { CircuitBreakerLayer } from "./circuit-breaker-tools.js";
export { RetryLogicLayer } from "./retry-logic-tools.js";
export { TimeoutManagementLayer } from "./timeout-management-tools.js";
export { WebhookLayer } from "./webhook-tools.js";
export { SchedulingLayer } from "./scheduling-tools.js";
export { NotificationRoutingLayer } from "./notification-routing-tools.js";
export { TemplateLayer } from "./template-tools.js";
export { WorkflowOrchestrationLayer } from "./workflow-orchestration-tools.js";
export { IdempotencyLayer } from "./idem-potency-tools.js";
export { AggregationLayer } from "./aggregation-tools.js";