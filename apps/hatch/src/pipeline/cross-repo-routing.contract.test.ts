import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

const EXAMPLE_TRADING_DOMAIN_GRAPH = resolve(REPO_ROOT, "factories/example-trading/graphs/domain_example_trading.dot");
const MOTHERSHIP_SUPERVISOR_TICK = resolve(REPO_ROOT, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const GOAL_EXECUTION_HANDOFF = resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-software-development/goal_execution_handoff.dot");
const RELEASE_REPORT_FLOW = resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot");
const RELEASE_CAPABILITY_CONTRACT = resolve(REPO_ROOT, "packages/capability-release-reporting/capability-contract.v1.json");

function extractBlock(content: string, nodeId: string): string {
	const start = content.indexOf(nodeId);
	if (start === -1) return "";
	return content.slice(start, content.indexOf("]", start) + 1);
}

describe("cross-repo routing contract", () => {
	it("example-trading domain graph resolves gh_repo from target_repo", () => {
		const content = readFileSync(EXAMPLE_TRADING_DOMAIN_GRAPH, "utf8");
		const ghRepoBlock = extractBlock(content, "set_gh_repo");

		// gh_repo must resolve target_repo first so goal/issue operations target the correct repo.
		// Regression: previously resolved home_repo first, causing release reports and goal sweeps
		// to target recallnet/astrochicken instead of example-org/example-trading.
		expect(
			ghRepoBlock.includes('action_id="common.resolve_default"') &&
				ghRepoBlock.includes('action_value="${target_repo}"') &&
				ghRepoBlock.includes('action_fallback="${target_repo}"'),
			"set_gh_repo must resolve target_repo first with target_repo fallback",
		).toBe(true);
	});

	it("release_report_flow publishes to release_reporting_repo (not gh_repo)", () => {
		const content = readFileSync(RELEASE_REPORT_FLOW, "utf8");
		const publishBlock = extractBlock(content, "publish_release_report");

		expect(
			publishBlock.includes("action_repo=\"${release_reporting_repo}\""),
			"publish_release_report must use release_reporting_repo",
		).toBe(true);
	});

	it("release capability contract requires release_reporting_repo context key", () => {
		const contract = JSON.parse(readFileSync(RELEASE_CAPABILITY_CONTRACT, "utf8"));
		expect(contract.requiredContextKeys).toContain("release_reporting_repo");
	});

	it("goal_execution_handoff resolves release_reporting_repo from target_repo first", () => {
		const content = readFileSync(GOAL_EXECUTION_HANDOFF, "utf8");
		const releaseRepoBlock = extractBlock(content, "set_release_reporting_repo");

		expect(
			releaseRepoBlock.includes('action_id="common.resolve_default"') &&
				releaseRepoBlock.includes('action_value="${target_repo}"') &&
				releaseRepoBlock.includes('action_fallback="${gh_repo}"'),
			"set_release_reporting_repo must resolve target_repo first",
		).toBe(true);
	});

	it("example-trading daily_release_report graph sets release_reporting_repo before release report flow", () => {
		const dailyReleaseGraph = resolve(REPO_ROOT, "factories/example-trading/graphs/daily_release_report.dot");
		const content = readFileSync(dailyReleaseGraph, "utf8");

		expect(
			content.includes("set_release_reporting_repo -> run_release_report_flow"),
			"set_release_reporting_repo must feed into run_release_report_flow",
		).toBe(true);
	});

	it("mothership daily_release_report graph sets release_reporting_repo before release report flow", () => {
		const dailyReleaseGraph = resolve(REPO_ROOT, "factories/mothership/graphs/daily_release_report.dot");
		const content = readFileSync(dailyReleaseGraph, "utf8");

		expect(
			content.includes("set_release_reporting_repo -> run_release_report_flow"),
			"set_release_reporting_repo must feed into run_release_report_flow",
		).toBe(true);
	});
});
