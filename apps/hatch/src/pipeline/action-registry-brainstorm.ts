import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned brainstorming capability action owners
import * as brainstormingActionOwners from "../../../../packages/capability-brainstorming/src/in-process-action-owners.mjs";

const {
	applyBrainstormLoopGuard,
	bumpBrainstormRound,
	buildBrainstormContextFromShellIntake,
	checkBrainstormOutput,
	closeBrainstormIssue,
	loadBrainstormContext,
	postBrainstormTurnComment,
	resolveCapabilityBrainstormingSkillsPath,
} = brainstormingActionOwners as {
	applyBrainstormLoopGuard: (options?: Record<string, unknown>) => unknown;
	bumpBrainstormRound: (options?: Record<string, unknown>) => unknown;
	buildBrainstormContextFromShellIntake: (options?: Record<string, unknown>) => unknown;
	checkBrainstormOutput: (options?: Record<string, unknown>) => unknown;
	closeBrainstormIssue: (options?: Record<string, unknown>) => unknown;
	loadBrainstormContext: (options?: Record<string, unknown>) => unknown;
	postBrainstormTurnComment: (options?: Record<string, unknown>) => unknown;
	resolveCapabilityBrainstormingSkillsPath: (options?: Record<string, unknown>) => string;
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

function textOutcome(value: string, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: value,
		contextUpdates,
	};
}

class ResolveCapabilityBrainstormingSkillsPathAction implements ActionExecutor {
	async execute(): Promise<Outcome> {
		return textOutcome(resolveCapabilityBrainstormingSkillsPath());
	}
}

class BuildBrainstormIntakeContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildBrainstormContextFromShellIntake({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: expandAttr(request.node, request.ctx, "action_root_dir") || request.workDir,
			intakeJson: expandAttr(request.node, request.ctx, "action_intake_json"),
		}));
	}
}

class LoadBrainstormContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(loadBrainstormContext({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: expandAttr(request.node, request.ctx, "action_root_dir") || request.workDir,
			brainstormIssueNumber: expandAttr(request.node, request.ctx, "action_brainstorm_issue_number"),
			brainstormIssueBody: expandAttr(request.node, request.ctx, "action_brainstorm_issue_body"),
			intentStackRaw: expandAttr(request.node, request.ctx, "action_intent_stack"),
			shippedGoalsSinceLastRaw: expandAttr(request.node, request.ctx, "action_shipped_goals_since_last"),
			scenarioHoldoutsRaw: expandAttr(request.node, request.ctx, "action_scenario_holdouts"),
			openBacklogSummary: expandAttr(request.node, request.ctx, "action_open_backlog_summary"),
		}));
	}
}

class CheckBrainstormOutputAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(checkBrainstormOutput({
			agentOutput: expandAttr(request.node, request.ctx, "action_agent_output"),
			source: expandAttr(request.node, request.ctx, "action_source"),
		}));
	}
}

class PostBrainstormTurnCommentAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(postBrainstormTurnComment({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			source: expandAttr(request.node, request.ctx, "action_source"),
			round: expandAttr(request.node, request.ctx, "action_round"),
			agentOutput: expandAttr(request.node, request.ctx, "action_agent_output"),
			isFinal: expandAttr(request.node, request.ctx, "action_is_final"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			langfuseProjectUrl: expandAttr(request.node, request.ctx, "action_langfuse_project_url"),
			suppressRoundComment: expandAttr(request.node, request.ctx, "action_suppress_round_comment"),
		}));
	}
}

class BrainstormLoopGuardAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(applyBrainstormLoopGuard({
			source: expandAttr(request.node, request.ctx, "action_source"),
			conversationalOutput: expandAttr(request.node, request.ctx, "action_conversational_output"),
			previousEmptyBlueCount: expandAttr(request.node, request.ctx, "action_previous_empty_blue_count"),
			emptyBlueThreshold: expandAttr(request.node, request.ctx, "action_empty_blue_threshold"),
			shouldForceWrap: expandAttr(request.node, request.ctx, "action_should_force_wrap"),
		}));
	}
}

class BumpBrainstormRoundAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(bumpBrainstormRound({
			round: expandAttr(request.node, request.ctx, "action_round") || request.input,
			maxRounds: expandAttr(request.node, request.ctx, "action_max_rounds"),
		}));
	}
}

class CloseBrainstormIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(closeBrainstormIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			brainstormIssueNumber: expandAttr(request.node, request.ctx, "action_brainstorm_issue_number"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: expandAttr(request.node, request.ctx, "action_root_dir") || request.workDir,
			nextCursorRaw: expandAttr(request.node, request.ctx, "action_next_cursor"),
		}));
	}
}

export function registerBrainstormActions(registry: ActionRegistry): void {
	registry.register("common.resolve_capability_brainstorming_skills_path", new ResolveCapabilityBrainstormingSkillsPathAction());
	registry.register("brainstorm.build_intake_context", new BuildBrainstormIntakeContextAction());
	registry.register("brainstorm.load_context", new LoadBrainstormContextAction());
	registry.register("brainstorm.check_output", new CheckBrainstormOutputAction());
	registry.register("brainstorm.loop_guard", new BrainstormLoopGuardAction());
	registry.register("brainstorm.post_turn_comment", new PostBrainstormTurnCommentAction());
	registry.register("brainstorm.bump_round", new BumpBrainstormRoundAction());
	registry.register("brainstorm.close_issue", new CloseBrainstormIssueAction());
}
