import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	collectGoalDecompositionTimeoutInventory,
	renderGoalDecompositionTimeoutInventoryMarkdown,
	type GoalDecompositionTimeoutInventory,
} from "./goal-decomposition-timeout-inventory.js";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const INVENTORY_JSON_PATH = join(REPO_ROOT, "factories/mothership/inventory/goal-decomposition-timeouts.json");
const INVENTORY_MD_PATH = join(REPO_ROOT, "factories/mothership/inventory/goal-decomposition-timeouts.md");

const EXPECTED_STAGE_OWNERSHIP = Object.freeze({
	issue_draft: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "draft_issue_spec",
	},
	issue_repair: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "repair_issue_spec",
	},
	issue_judge: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "judge_issue",
	},
	issue_revise: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "revise_issue_spec",
	},
});

function loadBaseline(): GoalDecompositionTimeoutInventory {
	return JSON.parse(readFileSync(INVENTORY_JSON_PATH, "utf-8")) as GoalDecompositionTimeoutInventory;
}

describe("goal decomposition timeout inventory baseline", () => {
	const liveInventory = collectGoalDecompositionTimeoutInventory({ repoRootPath: REPO_ROOT });
	const baseline = loadBaseline();

	it("machine-readable inventory stays aligned with resolver output and graph ownership", () => {
		expect(liveInventory).toEqual(baseline);
	});

	it("human-readable summary stays aligned with generated inventory", () => {
		const summary = readFileSync(INVENTORY_MD_PATH, "utf-8");
		expect(summary).toBe(renderGoalDecompositionTimeoutInventoryMarkdown(liveInventory));
	});

	it("contains all four required stages mapped to expected graph and node ids", () => {
		const stageMap = Object.fromEntries(liveInventory.entries.map((entry) => [entry.stage, entry]));
		expect(Object.keys(stageMap).sort()).toEqual(Object.keys(EXPECTED_STAGE_OWNERSHIP).sort());

		for (const [stage, ownership] of Object.entries(EXPECTED_STAGE_OWNERSHIP)) {
			const entry = stageMap[stage];
			expect(entry).toBeDefined();
			expect(entry.graph_path).toBe(ownership.graph_path);
			expect(entry.node_id).toBe(ownership.node_id);
		}
	});
});
