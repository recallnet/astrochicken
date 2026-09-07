import { assertMainClean } from "../../../packages/factory-ops/src/commands/merge-assert-main-clean.ts";
import {
	attemptDeterministicMerge,
	assertMainBranch,
	buildConflictPacket,
	buildGoalScopedMergeMessage,
	buildMergeReport,
	emitResolutionFailure,
	extractMergeItem,
	finalizeMergeCommit,
	pushMainBranch,
	rebaseBranchOnMain,
	resolveMergeContext,
	runMergeIntegration,
	verifyConflictResolution,
} from "../../../packages/factory-ops/src/commands/merge-item-ops.ts";
import { acquireMergeLock, releaseMergeLock } from "../../../packages/factory-ops/src/commands/merge-lock.ts";
import { verifyPushRecovery } from "../../../packages/factory-ops/src/commands/merge-verify-push-recovery.ts";
import { cleanupMergeWorktree, setupMergeWorktree } from "../../../packages/factory-ops/src/commands/merge-worktree.ts";

export {
	acquireMergeLock,
	assertMainBranch,
	assertMainClean,
	attemptDeterministicMerge,
	buildConflictPacket,
	buildGoalScopedMergeMessage,
	buildMergeReport,
	cleanupMergeWorktree,
	emitResolutionFailure,
	extractMergeItem,
	finalizeMergeCommit,
	pushMainBranch,
	rebaseBranchOnMain,
	releaseMergeLock,
	resolveMergeContext,
	runMergeIntegration,
	setupMergeWorktree,
	verifyPushRecovery,
	verifyConflictResolution,
};
