import { collectActiveWaveLeasesFromRepo } from "./wave-claim.ts";
import {
  applyWaveOrphanStateRepair as applyWaveOrphanStateRepairImpl,
  requeueAfterJudgeFailure as requeueAfterJudgeFailureImpl,
  sanitizeWaveState as sanitizeWaveStateImpl,
} from "./wave-sanitize-executor.ts";
import {
  WAVE_ORPHAN_REPAIR_SCHEMA_VERSION,
  hasLabel,
  issueNumber,
  isWaveMarker,
  milestoneTitleFor,
  isOpenIssue,
  buildEmptyPlan,
  summarizePlan,
  planRollup,
  collectActiveWaveLeases as collectActiveWaveLeasesImpl,
  readRunStatuses as readRunStatusesImpl,
  readRunMetadata as readRunMetadataImpl,
  downgradeOrphanedLeases as downgradeOrphanedLeasesImpl,
  planStaleWorktreeCleanupActions as planStaleWorktreeCleanupActionsImpl,
  planWaveOrphanStateRepair as planWaveOrphanStateRepairImpl,
  planWaveReadyNormalization as planWaveReadyNormalizationImpl,
} from "./wave-sanitize-rules.ts";

if (false) {
  collectActiveWaveLeasesFromRepo({});
}

export {
  WAVE_ORPHAN_REPAIR_SCHEMA_VERSION,
  hasLabel,
  issueNumber,
  isWaveMarker,
  milestoneTitleFor,
  isOpenIssue,
  buildEmptyPlan,
  summarizePlan,
  planRollup,
};

export function collectActiveWaveLeases(...args) {
  return collectActiveWaveLeasesImpl(...args);
}

export function readRunStatuses(...args) {
  return readRunStatusesImpl(...args);
}

export function readRunMetadata(...args) {
  return readRunMetadataImpl(...args);
}

export function downgradeOrphanedLeases(...args) {
  return downgradeOrphanedLeasesImpl(...args);
}

export function planStaleWorktreeCleanupActions(...args) {
  return planStaleWorktreeCleanupActionsImpl(...args);
}

export function planWaveOrphanStateRepair(...args) {
  return planWaveOrphanStateRepairImpl(...args);
}

export function planWaveReadyNormalization(...args) {
  return planWaveReadyNormalizationImpl(...args);
}

export function applyWaveOrphanStateRepair(...args) {
  return applyWaveOrphanStateRepairImpl(...args);
}

export function requeueAfterJudgeFailure(...args) {
  return requeueAfterJudgeFailureImpl(...args);
}

export function sanitizeWaveState(...args) {
  return sanitizeWaveStateImpl(...args);
}
