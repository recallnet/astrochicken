import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const CAPABILITY_ROOT = resolve(REPO_ROOT, "docs/contracts/workflow-ir/capability-software-development");

const GOAL_EXECUTE_PATH = join(CAPABILITY_ROOT, "goal_execute.dot");
const GOAL_ISSUE_EXECUTE_PATH = join(CAPABILITY_ROOT, "goal_issue_execute.dot");

function readGraph(path: string): string {
	return readFileSync(path, "utf8");
}

describe("@hatch/capability-software-development execution portability contract", () => {
	it("goal_execute references shared goal_issue_execute pipeline path", () => {
		const content = readGraph(GOAL_EXECUTE_PATH);
		expect(content).toContain(
			'pipeline="@hatch/capability-software-development/workflows/goal_issue_execute/goal_issue_execute.workflow-source.mjs"',
		);
		expect(content).not.toContain('pipeline="docs/contracts/workflow-ir/mothership/goal_issue_execute.dot"');
	});

	it("extracted graphs contain no hardcoded mothership/repo literals", () => {
		const goalExecute = readGraph(GOAL_EXECUTE_PATH);
		const goalIssueExecute = readGraph(GOAL_ISSUE_EXECUTE_PATH);
		const combined = `${goalExecute}\n${goalIssueExecute}`;

		expect(combined).not.toContain("mothership.local");
		expect(combined).not.toContain("factories/mothership/");
		expect(combined).not.toContain("recallnet/astrochicken");
	});

	it("extracted execution graphs avoid wave/milestone command dependencies", () => {
		const goalExecute = readGraph(GOAL_EXECUTE_PATH);
		const goalIssueExecute = readGraph(GOAL_ISSUE_EXECUTE_PATH);
		const combined = `${goalExecute}\n${goalIssueExecute}`;

		expect(combined).not.toContain("hatch-ops wave ");
		expect(combined).not.toContain("hatch-ops milestone ");
	});
});
