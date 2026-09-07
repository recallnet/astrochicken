import {
  WAVE_MARKER_CLAIM_SCHEMA_VERSION as WAVE_MARKER_CLAIM_SCHEMA_VERSION_VALUE,
  WAVE_MARKER_CLAIM_BLOCK_START as WAVE_MARKER_CLAIM_BLOCK_START_VALUE,
  WAVE_MARKER_CLAIM_BLOCK_END as WAVE_MARKER_CLAIM_BLOCK_END_VALUE,
  WAVE_MARKER_CLAIM_TRANSITION_OWNERS as WAVE_MARKER_CLAIM_TRANSITION_OWNERS_VALUE,
  milestoneTitleForWaveMarker as milestoneTitleForWaveMarkerImpl,
  buildDeterministicClaimToken as buildDeterministicClaimTokenImpl,
  normalizeWaveMarkerClaim as normalizeWaveMarkerClaimImpl,
  parseWaveMarkerClaimFromBody as parseWaveMarkerClaimFromBodyImpl,
  upsertWaveMarkerClaimInBody as upsertWaveMarkerClaimInBodyImpl,
  describeWaveMarkerClaim as describeWaveMarkerClaimImpl,
  parseWaveMarkerClaimSnapshot as parseWaveMarkerClaimSnapshotImpl,
  createWaveClaimGhClient as createWaveClaimGhClientImpl,
  acquireWaveMarkerClaim as acquireWaveMarkerClaimImpl,
  validateWaveMarkerClaimOwnership as validateWaveMarkerClaimOwnershipImpl,
  releaseWaveMarkerClaim as releaseWaveMarkerClaimImpl,
} from "../lib/wave-marker-claim.ts";
import {
  lockReadyWaveIssue as lockReadyWaveIssueImpl,
  completeReadyWaveIssue as completeReadyWaveIssueImpl,
  releaseReadyWaveClaim as releaseReadyWaveClaimOpsImpl,
} from "../lib/wave-ready-claim-ops.ts";
import {
  buildWaveReadyLeaseEvent as buildWaveReadyLeaseEventImpl,
  WAVE_READY_LEASE_EVENT_SCHEMA_VERSION as WAVE_READY_LEASE_EVENT_SCHEMA_VERSION_VALUE,
} from "../lib/wave-ready-lease-cloudevents.ts";
import {
  WAVE_READY_LEASE_EVENT_PREFIX as WAVE_READY_LEASE_EVENT_PREFIX_VALUE,
  parseWaveReadyLeaseEventsFromComment as parseWaveReadyLeaseEventsFromCommentImpl,
  renderWaveReadyLeaseComment as renderWaveReadyLeaseCommentImpl,
  collectActiveWaveLeasesFromIssues as collectActiveWaveLeasesFromIssuesImpl,
  collectActiveWaveLeasesFromRepo as collectActiveWaveLeasesFromRepoImpl,
  claimReadyWaveIssue as claimReadyWaveIssueImpl,
  releaseReadyWaveClaim as releaseReadyWaveClaimImpl,
} from "../lib/wave-ready-lease.ts";

export const WAVE_MARKER_CLAIM_SCHEMA_VERSION = WAVE_MARKER_CLAIM_SCHEMA_VERSION_VALUE;
export const WAVE_MARKER_CLAIM_BLOCK_START = WAVE_MARKER_CLAIM_BLOCK_START_VALUE;
export const WAVE_MARKER_CLAIM_BLOCK_END = WAVE_MARKER_CLAIM_BLOCK_END_VALUE;
export const WAVE_MARKER_CLAIM_TRANSITION_OWNERS = WAVE_MARKER_CLAIM_TRANSITION_OWNERS_VALUE;

export const WAVE_READY_LEASE_EVENT_SCHEMA_VERSION = WAVE_READY_LEASE_EVENT_SCHEMA_VERSION_VALUE;
export const WAVE_READY_LEASE_EVENT_PREFIX = WAVE_READY_LEASE_EVENT_PREFIX_VALUE;

export function milestoneTitleForWaveMarker(...args) {
  return milestoneTitleForWaveMarkerImpl(...args);
}

export function buildDeterministicClaimToken(...args) {
  return buildDeterministicClaimTokenImpl(...args);
}

export function normalizeWaveMarkerClaim(...args) {
  return normalizeWaveMarkerClaimImpl(...args);
}

export function parseWaveMarkerClaimFromBody(...args) {
  return parseWaveMarkerClaimFromBodyImpl(...args);
}

export function upsertWaveMarkerClaimInBody(...args) {
  return upsertWaveMarkerClaimInBodyImpl(...args);
}

export function describeWaveMarkerClaim(...args) {
  return describeWaveMarkerClaimImpl(...args);
}

export function parseWaveMarkerClaimSnapshot(...args) {
  return parseWaveMarkerClaimSnapshotImpl(...args);
}

export function createWaveClaimGhClient(...args) {
  return createWaveClaimGhClientImpl(...args);
}

export function acquireWaveMarkerClaim(...args) {
  return acquireWaveMarkerClaimImpl(...args);
}

export function validateWaveMarkerClaimOwnership(...args) {
  return validateWaveMarkerClaimOwnershipImpl(...args);
}

export function releaseWaveMarkerClaim(...args) {
  return releaseWaveMarkerClaimImpl(...args);
}

export function lockReadyWaveIssue(...args) {
  return lockReadyWaveIssueImpl(...args);
}

export function completeReadyWaveIssue(...args) {
  return completeReadyWaveIssueImpl(...args);
}

export function releaseReadyWaveClaimOps(...args) {
  return releaseReadyWaveClaimOpsImpl(...args);
}

export function parseWaveReadyLeaseEventsFromComment(...args) {
  return parseWaveReadyLeaseEventsFromCommentImpl(...args);
}

export function buildWaveReadyLeaseEvent(...args) {
  return buildWaveReadyLeaseEventImpl(...args);
}

export function renderWaveReadyLeaseComment(...args) {
  return renderWaveReadyLeaseCommentImpl(...args);
}

export function collectActiveWaveLeasesFromIssues(...args) {
  return collectActiveWaveLeasesFromIssuesImpl(...args);
}

export function collectActiveWaveLeasesFromRepo(...args) {
  return collectActiveWaveLeasesFromRepoImpl(...args);
}

export function claimReadyWaveIssue(...args) {
  return claimReadyWaveIssueImpl(...args);
}

export function releaseReadyWaveClaim(...args) {
  return releaseReadyWaveClaimImpl(...args);
}
