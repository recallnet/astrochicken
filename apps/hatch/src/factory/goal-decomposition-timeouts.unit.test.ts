import { describe, expect, it } from "vitest";

import {
	GOAL_DECOMPOSITION_TIMEOUT_DEFAULTS,
	GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH,
	GOAL_DECOMPOSITION_TIMEOUT_STAGES,
	resolveGoalDecompositionTimeouts,
} from "./goal-decomposition-timeouts.js";

describe("goal decomposition timeout resolver", () => {
	it("exports all four stage keys", () => {
		expect([...GOAL_DECOMPOSITION_TIMEOUT_STAGES]).toEqual([
			"issue_draft",
			"issue_repair",
			"issue_judge",
			"issue_revise",
		]);
	});

	it("returns defaults when config omits capabilities.goal_decomposition.timeouts", () => {
		const resolved = resolveGoalDecompositionTimeouts({});
		expect(resolved.issue_draft.timeout).toBe(GOAL_DECOMPOSITION_TIMEOUT_DEFAULTS.issue_draft);
		expect(resolved.issue_draft.source).toBe("default");
		expect(resolved.issue_draft.source_key_path).toBe("@hatch/capability-goal-decomposition/timeouts.defaults.json.issue_draft");
	});

	it("uses stage override when provided", () => {
		const resolved = resolveGoalDecompositionTimeouts({
			capabilities: {
				goal_decomposition: {
					timeouts: {
						issue_draft: "45m",
					},
				},
			},
		});
		expect(resolved.issue_draft.timeout).toBe("45m");
		expect(resolved.issue_draft.source).toBe("override");
		expect(resolved.issue_draft.source_key_path).toBe(`${GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH}.issue_draft`);
		expect(resolved.issue_draft.timeout_ms).toBe(2_700_000);
	});

	it("fails closed when override type is invalid", () => {
		expect(() => resolveGoalDecompositionTimeouts({
			capabilities: {
				goal_decomposition: {
					timeouts: {
						issue_draft: 123,
					},
				},
			},
		})).toThrow("capabilities.goal_decomposition.timeouts.issue_draft must be a string when provided");
	});

	it("fails closed when override duration format is invalid", () => {
		expect(() => resolveGoalDecompositionTimeouts({
			capabilities: {
				goal_decomposition: {
					timeouts: {
						issue_draft: "30minutes",
					},
				},
			},
		})).toThrow("capabilities.goal_decomposition.timeouts.issue_draft must match /^\\d+(ms|s|m|h|d)$/");
	});
});
