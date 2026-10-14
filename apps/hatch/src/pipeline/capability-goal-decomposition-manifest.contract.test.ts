import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

interface GoalDecompositionTimeoutDefaults {
	issue_draft: string;
	issue_repair: string;
	issue_judge: string;
	issue_revise: string;
	[key: string]: string;
}

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-goal-decomposition");
const CAPABILITY_TIMEOUT_DEFAULTS_PATH = join(CAPABILITY_ROOT, "timeouts.defaults.json");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

function loadTimeoutDefaults(): GoalDecompositionTimeoutDefaults {
	const raw = readFileSync(CAPABILITY_TIMEOUT_DEFAULTS_PATH, "utf8");
	return JSON.parse(raw) as GoalDecompositionTimeoutDefaults;
}

describe("@hatch/capability-goal-decomposition manifest contract", () => {
	registerFilesystemContract();

	it("requiredContextKeys includes capability_goal_decomposition_skills", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("capability_goal_decomposition_skills");
		expect(contract.requiredContextKeys).toContain("scenarios_root");
	});

	it("requiredRoles contains explicit Stage 1 decomposition role handles", () => {
		const contract = loadContract();
		expect(contract.requiredRoles).toContain(".goal_batch_reviewer");
		expect(contract.requiredRoles).toContain(".goal_decomposer");
		expect(contract.requiredRoles).toContain(".issue_writer");
		expect(contract.requiredRoles).toContain(".issue_quality_judge");
		expect(contract.requiredRoles).not.toContain(".judge");
		expect(contract.requiredRoles).not.toContain(".knowledge_worker");
	});

	it("requiredHandlers is a non-empty array containing tool", () => {
		const contract = loadContract();
		expect(Array.isArray(contract.requiredHandlers)).toBe(true);
		expect(contract.requiredHandlers.length).toBeGreaterThan(0);
		expect(contract.requiredHandlers).toContain("tool");
	});

	it("capability timeout defaults artifact exists with all required stage keys", () => {
		expect(existsSync(CAPABILITY_TIMEOUT_DEFAULTS_PATH)).toBe(true);
		const defaults = loadTimeoutDefaults();
		expect(defaults).toEqual({
			issue_draft: "30m",
			issue_repair: "30m",
			issue_judge: "30m",
			issue_revise: "30m",
		});
	});
});
