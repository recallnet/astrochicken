import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { type CapabilityManifestContract, createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

interface CapabilityOwnedStage {
	stage: string;
	entrypoint: string;
	scope: string;
}

interface CapabilityContract extends CapabilityManifestContract {
	ownedStages?: CapabilityOwnedStage[];
	exportedContextKeys: Record<string, string[]>;
	roleSessionAssumptions: Record<string, unknown>;
	nonGoals: string[];
}

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-software-development");

const { loadContract, declaredGraphs, registerFilesystemContract } = createCapabilityManifestFixture<CapabilityContract>(CAPABILITY_ROOT);

describe("@hatch/capability-software-development manifest contract", () => {
	registerFilesystemContract({ checkSkills: false });

	it("requiredContextKeys include execution portability contract keys", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("gh_repo");
		expect(contract.requiredContextKeys).toContain("repo");
		expect(contract.requiredContextKeys).toContain("goal_issue_number");
		expect(contract.requiredContextKeys).toContain("factory_root");
		expect(contract.requiredContextKeys).toContain("factory_id");
		expect(contract.requiredContextKeys).toContain("control_plane_repo");
		expect(contract.requiredContextKeys).toContain("scenarios_root");
		expect(contract.requiredContextKeys).toContain("capability_coding_skills");
		expect(contract.requiredContextKeys).toContain("capability_merge_skills");
		expect(contract.requiredContextKeys).toContain("integration_command");
		expect(contract.requiredContextKeys).toContain("review_qa_command");
		expect(contract.requiredContextKeys).toContain("trust_domain");
		expect(contract.requiredContextKeys).toContain("trust_role");
	});

	it("requiredRoles and handlers cover extracted execution flow", () => {
		const contract = loadContract();
		expect(contract.requiredRoles).toContain(".coder");
		expect(contract.requiredRoles).toContain(".reviewer");
		expect(contract.requiredRoles).toContain(".merge_resolver");
		expect(contract.requiredRoles).toContain(".post_merge_judge");
		expect(contract.requiredHandlers).toContain("tool");
		expect(contract.requiredHandlers).toContain("pipeline");
		expect(contract.requiredHandlers).toContain("agent.worktree");
		expect(contract.requiredHandlers).toContain("codergen");
	});

	it("exportedContextKeys include execution outputs for extracted graphs", () => {
		const contract = loadContract();
		const executionExports = contract.exportedContextKeys["workflows/goal_execute/goal_execute.workflow-source.mjs"] || [];
		expect(executionExports).toContain("goal_terminal_path");
		expect(executionExports).toContain("impl_results");
		expect(executionExports).toContain("merge_candidates");
		expect(executionExports).toContain("merged_results");

		const issueExecutionExports = contract.exportedContextKeys["workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs"] || [];
		expect(issueExecutionExports).toContain("impl_result");
	});

	it("extracted shared graphs are declared in manifest", () => {
		const contract = loadContract();
		expect(declaredGraphs(contract)).toContain("workflows/goal_execute/goal_execute.workflow-source.mjs");
		expect(declaredGraphs(contract)).toContain("workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs");
	});

	it("declares owned software-development stages and entrypoints", () => {
		const contract = loadContract();
		const ownedStages = contract.ownedStages ?? [];
		expect(ownedStages.length).toBeGreaterThanOrEqual(6);
		expect(ownedStages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "coding_worktree_execution",
					entrypoint: "workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs",
				}),
				expect.objectContaining({
					stage: "judge_review",
					entrypoint: "workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs",
				}),
				expect.objectContaining({
					stage: "merge_preparation_and_execution",
					entrypoint: "workflows/goal_execute/goal_execute.workflow-source.mjs",
				}),
				expect.objectContaining({
					stage: "failure_routing",
					entrypoint: "workflows/goal_execute/goal_execute.workflow-source.mjs",
				}),
			]),
		);
	});

	it("nonGoals keep supervisor/runtime and direct transport ownership out of capability", () => {
		const contract = loadContract();
		const nonGoals = contract.nonGoals.join("\n");
		expect(nonGoals).toContain("managed-supervisor shell/runtime responsibilities");
		expect(nonGoals).toContain("Direct GitHub transport");
		expect(nonGoals).toContain("packages/factory-runtime-guard");
	});
});
