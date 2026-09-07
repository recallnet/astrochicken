import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned release capability action owners
import * as releaseActionOwners from "../../../../packages/capability-release-reporting/src/in-process-action-owners.mjs";

const {
	runAnalysisLensFinalize,
	runAnalysisLensFollowupCandidates,
	runAnalysisLensPrepare,
} = releaseActionOwners as {
	runAnalysisLensFinalize: (options?: Record<string, unknown>) => Promise<unknown>;
	runAnalysisLensFollowupCandidates: (options?: Record<string, unknown>) => Promise<unknown>;
	runAnalysisLensPrepare: (options?: Record<string, unknown>) => Promise<unknown>;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function jsonOutcome(value: unknown, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: JSON.stringify(value),
		contextUpdates,
	};
}

function parseJsonAttr(node: Node, ctx: Context, key: string, fallback: unknown): unknown {
	const raw = expandAttr(node, ctx, key);
	if (!raw) return fallback;
	return JSON.parse(raw);
}

class DailyLensPrepareAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await runAnalysisLensPrepare({
			date: expandAttr(request.node, request.ctx, "action_date"),
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			outputDir: expandAttr(request.node, request.ctx, "action_output_dir"),
			windowStart: expandAttr(request.node, request.ctx, "action_window_start"),
			windowEnd: expandAttr(request.node, request.ctx, "action_window_end"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			repoPath: expandAttr(request.node, request.ctx, "action_repo_path") || request.workDir,
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			issueLabels: parseJsonAttr(request.node, request.ctx, "action_issue_labels_json", ["daily-lens"]),
			notifySlack: expandAttr(request.node, request.ctx, "action_notify_slack") === "true",
		}));
	}
}

class DailyLensFinalizeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await runAnalysisLensFinalize({
			date: expandAttr(request.node, request.ctx, "action_date"),
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			outputDir: expandAttr(request.node, request.ctx, "action_output_dir"),
			bundlePath: expandAttr(request.node, request.ctx, "action_bundle_path"),
			analysisPath: expandAttr(request.node, request.ctx, "action_analysis_path"),
			windowStart: expandAttr(request.node, request.ctx, "action_window_start"),
			windowEnd: expandAttr(request.node, request.ctx, "action_window_end"),
			notifySlack: expandAttr(request.node, request.ctx, "action_notify_slack") === "true",
			issueLabels: parseJsonAttr(request.node, request.ctx, "action_issue_labels_json", ["daily-lens"]),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			publicationSha: expandAttr(request.node, request.ctx, "action_publication_sha"),
			skipFollowupCandidates: expandAttr(request.node, request.ctx, "action_skip_followup_candidates") === "true",
		}));
	}
}

class DailyLensFollowupCandidatesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await runAnalysisLensFollowupCandidates({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			reportIssueNumber: expandAttr(request.node, request.ctx, "action_report_issue_number"),
			analysisPath: expandAttr(request.node, request.ctx, "action_analysis_path"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			publicationSha: expandAttr(request.node, request.ctx, "action_publication_sha"),
		}));
	}
}

export function registerDailyLensActions(registry: ActionRegistry): void {
	registry.register("daily_lens.prepare", new DailyLensPrepareAction());
	registry.register("daily_lens.finalize", new DailyLensFinalizeAction());
	registry.register("daily_lens.generate_followup_candidates", new DailyLensFollowupCandidatesAction());
}
