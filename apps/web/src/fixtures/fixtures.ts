// Fixture data — content copied verbatim from the r7 capture session
// (docs/research/r7-rebaseline.md §5): probe #9, r3 legacy #1/#2, project
// and team identifiers, branch strings, 13:21/13:35 timestamps. The #1/#2
// titles were extracted from captures 01/01b by glyph template matching
// (glyph template matching) in #54; all other strings come from the research
// records.
//
// Re-export barrel over the per-domain fixture modules; import sites keep
// consuming ./fixtures.js.

export {
  agentDelete,
  agentDetail,
  agentDetailActive,
  agentDetailMemory,
  agentDetailSecrets,
  chiefAgentChip,
  chiefFabAvatar,
  chiefFabAvatarOverride,
} from './agents.js';
export { apiKeysCreated } from './api-keys.js';
export {
  boardChiefProbes,
  boardDarkFresh,
  boardDefault,
  boardDragMatrix,
  boardGithubPicker,
  boardMachinePicker,
  boardOverflow,
  boardProjectPicker,
  boardRepoFilter,
  boardResetGate,
  boardStress,
  boardTagFilter,
  boardTagFilterEmpty,
  boardWithProbe,
} from './board.js';
export {
  chiefDefault,
  chiefGated,
  chiefMarkdown,
  chiefReady,
  chiefScrollLong,
  chiefSettings,
  chiefSettingsMachines,
  chiefSettingsStaleModel,
  chiefStreaming,
  chiefThread,
  chiefThreadsLong,
  chiefThreadsOpen,
} from './chief.js';
export {
  AGENT_MODEL_LINE,
  at,
  localTodo,
  MACHINE_ID,
  MACHINE_NAME,
  PROBE_BRANCH_INFO,
  PROBE_ID,
  PROBE_RUN_HISTORY,
  PROBE_TOKEN_USAGE,
  PROJECT_ID,
  PROJECT_INITIAL,
  PROJECT_NAME,
  projectContent,
  R3_DAY,
  R7_BUILD_BRANCH,
  R7_BUILD_ID,
  R7_DAY,
  R7_TARGET_COMMIT,
  R8_DAY,
  r7,
  r8,
  TEAM_ID,
  TEAM_NAME,
  USER_NAME,
} from './core.js';
export {
  detailBuilding,
  detailConfirm,
  detailDiffWordStress,
  detailDone,
  detailFailedCurrent,
  detailFresh,
  detailFreshDark,
  detailLegacy,
  detailLegacyNow,
  detailPlanning,
  detailReview,
  detailSpinnerQuiescent,
  overlayContent,
  PROBE_TOOL_CALL_LABEL,
  PROBE_TOOL_PILLS,
  r8OverlayContent,
} from './detail.js';
export { projectFixture, projectLocalFiles, projectTasks, projectTasksEmpty } from './projects.js';
export {
  boardFailed,
  compareMenuV2,
  detailFailed12,
  detailFailed15Set,
  detailV3Collapsed,
  diffV1V2,
  diffV2V3,
  history12,
  history15,
  mdToolout,
  planOpenReview,
  rerunDialog12,
  rerunDialog15,
  reusedBuilding,
  reusePanel15,
  revisionChain,
  revisionStreaming,
  skillInject,
  skillInjectZero,
  skillsRouting,
  versionMenuV2,
  versionMenuV3,
} from './r8-dynamic.js';
export {
  boardR8Overlay,
  detailR8Confirm,
  detailR8DeleteFresh,
  detailR8Fresh,
} from './r8-overlay.js';
export {
  machinesChiefState,
  resourcesCcBinGone,
  resourcesCcLegacy,
  resourcesCcLoggedOut,
  resourcesCcMissing,
  resourcesCcNoConfig,
  resourcesDefault,
} from './resources.js';
export {
  schedulesEmpty,
  schedulesFormDaily,
  schedulesFormOnce,
  schedulesList,
} from './schedules.js';
export {
  TEAM_R7,
  teamGrid,
  teamOrgChart,
  teamOrgChartEmpty,
  teamOrgChartSingle,
} from './team.js';
