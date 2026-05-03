/**
 * Hybrid Automation Module — UC-D02 through UC-D13.
 *
 * Barrel re-export for all automation functionality.
 * Use this module for imports; individual modules are implementation details.
 *
 * @module hybrid/automation
 */

// Re-export all types
export type {
  // UC-D02
  MachineManifest,
  MigrationPlan,
  MigrationStep,
  MigrationResult,
  // UC-D03
  TranscriptionResult,
  VoiceCommandResult,
  // UC-D04
  ActionSequence,
  RecordedAction,
  MacroDefinition,
  MacroParam,
  MacroResult,
  // UC-D05
  AppContext,
  DataPayload,
  AppWorkflow,
  AppWorkflowStep,
  WorkflowResult,
  // UC-D06
  RemoteBridgeConfig,
  RemoteBridge,
  RemoteCommand,
  RemoteResult,
  // UC-D07
  DesiredStateSpec,
  StateCheck,
  DriftReport,
  DriftViolation,
  EnforcementResult,
  // UC-D08
  CheckpointInfo,
  RollbackResult,
  // UC-D09
  ContextPackage,
  // UC-D10
  UserAction,
  UsageProfile,
  AutomationSuggestion,
  UserProfile,
  // UC-D11
  GeneratedScript,
  ScriptResult,
  // UC-D12
  WorkContext,
  ActionSuggestion,
  // UC-D13
  UserSession,
} from "./automation-types.js";

// Re-export shared state and utilities
export {
  execAsync,
  execFileAsync,
  getClient,
  _client,
  _recordingSessions,
  _remoteBridges,
  _stateLoops,
  QUICK_ACTIONS,
} from "./automation-types.js";

// Re-export storage helpers from desktop (where they're defined)
export {
  OMNISTATE_DIR,
  ensureDir,
  readJson,
  writeJson,
  generateId,
} from "./automation-desktop.js";

// Re-export browser automation functions
export {
  // UC-D03 Voice Control
  prepareWav,
  wrapPcmAsWav,
  transcribeAudio,
  speak,
  processVoiceCommand,
  // UC-D05 Multi-App Orchestration
  transferData,
  orchestrateApps,
  copyBetweenApps,
  // UC-D06 Remote Control Bridge
  authorizeRemoteCommand,
  startRemoteBridge,
  stopRemoteBridge,
  handleRemoteCommand,
  streamResultToRemote,
  // UC-D09 Context Handoff
  serializeContext,
  sendContextToDevice,
  receiveContext,
  // UC-D11 Script Generation
  executeJxa,
  executeAppleScript,
  quickSystemAction,
  generateScript,
  executeGeneratedScript,
  saveScript,
} from "./automation-browser.js";

// Re-export desktop automation functions
export {
  // UC-D02 System Migration
  scanSourceMachine,
  generateMigrationPlan,
  executeMigration,
  // UC-D04 Macros
  startRecording,
  stopRecording,
  inferMacro,
  saveMacro,
  listMacros,
  runMacro,
  // UC-D07 Desired State
  defineDesiredState,
  checkDrift,
  enforcState,
  startDesiredStateLoop,
  stopDesiredStateLoop,
  // UC-D08 Checkpoints
  recordCheckpoint,
  listCheckpoints,
  rollbackToCheckpoint,
  undoLastAction,
  // UC-D10 Usage Patterns
  recordUserAction,
  analyzePatterns,
  suggestAutomation,
  getUserProfile,
  // UC-D12 Action Suggestion
  getCurrentContext,
  suggestNextAction,
  autoExecuteSuggestion,
  // UC-D13 User Isolation
  getCurrentUserSession,
  switchUserSession,
  listUserSessions,
  isolateUserData,
} from "./automation-desktop.js";
