import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface CapabilityOwnedStage {
	stage: string;
	entrypoint: string;
	scope: string;
}

interface CapabilityContract {
	entrypoints: { kind: string; path: string }[];
	skillPaths: string[];
	ownedStages?: CapabilityOwnedStage[];
	requiredContextKeys: string[];
	requiredRoles: string[];
	requiredHandlers: string[];
	exportedContextKeys: Record<string, string[]>;
	roleSessionAssumptions: Record<string, unknown>;
	nonGoals: string[];
}

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-software-development");
const CAPABILITY_CONTRACT_PATH = join(CAPABILITY_ROOT, "capability-manifest.v1.json");

function loadContract(): CapabilityContract {
	const raw = readFileSync(CAPABILITY_CONTRACT_PATH, "utf8");
	return JSON.parse(raw) as CapabilityContract;
}

function declaredGraphs(contract: CapabilityContract): string[] {
	return contract.entrypoints.filter((entrypoint) => entrypoint.kind === "graph").map((entrypoint) => entrypoint.path);
}

function collectDotFiles(dir: string): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectDotFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".dot")) {
			files.push(relative(CAPABILITY_ROOT, fullPath).replaceAll("\\", "/"));
		}
	}
	return files.sort();
}

describe("@hatch/capability-software-development manifest contract", () => {
	it("every declared graph path exists on disk", () => {
		const contract = loadContract();
		for (const graphPath of declaredGraphs(contract)) {
			const fullPath = join(CAPABILITY_ROOT, graphPath);
			expect(existsSync(fullPath), `declared graph missing: ${graphPath}`).toBe(true);
		}
	});

	it("has no undeclared .dot files in graphs/", () => {
		const contract = loadContract();
		const graphDotFiles = collectDotFiles(join(CAPABILITY_ROOT, "graphs"));
		expect(graphDotFiles.length).toBeGreaterThan(0);
		for (const dotPath of graphDotFiles) {
			expect(declaredGraphs(contract)).toContain(dotPath);
		}
	});

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
		const executionExports = contract.exportedContextKeys["graphs/goal_execute.dot"] || [];
		expect(executionExports).toContain("goal_terminal_path");
		expect(executionExports).toContain("impl_results");
		expect(executionExports).toContain("merge_candidates");
		expect(executionExports).toContain("merged_results");

		const issueExecutionExports = contract.exportedContextKeys["graphs/goal_issue_execute.dot"] || [];
		expect(issueExecutionExports).toContain("impl_result");
	});

	it("extracted shared graphs are declared in manifest", () => {
		const contract = loadContract();
		expect(declaredGraphs(contract)).toContain("graphs/goal_execute.dot");
		expect(declaredGraphs(contract)).toContain("graphs/goal_issue_execute.dot");
	});

	it("declares owned software-development stages and entrypoints", () => {
		const contract = loadContract();
		const ownedStages = contract.ownedStages ?? [];
		expect(ownedStages.length).toBeGreaterThanOrEqual(6);
		expect(ownedStages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					stage: "coding_worktree_execution",
					entrypoint: "graphs/goal_issue_execute.dot",
				}),
				expect.objectContaining({
					stage: "judge_review",
					entrypoint: "graphs/goal_issue_execute.dot",
				}),
				expect.objectContaining({
					stage: "merge_preparation_and_execution",
					entrypoint: "graphs/goal_execute.dot",
				}),
				expect.objectContaining({
					stage: "failure_routing",
					entrypoint: "graphs/goal_execute.dot",
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
