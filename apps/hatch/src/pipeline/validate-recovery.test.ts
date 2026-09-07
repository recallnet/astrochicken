import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";
import { RECOVERY_OWNER_MISSING_CODE } from "./recovery-contract.js";
import { hasValidationErrors, validate } from "./validate.js";

describe("validate() graph recovery integration", () => {
	it("surfaces graph_recovery.dead_end in the standard validation path", () => {
		const graph = parse(`
	digraph validate_dead_end {
		start [shape=Mdiamond]
		build [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> build
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "graph_recovery.dead_end",
					nodeId: "build",
				}),
			]),
		);
		expect(hasValidationErrors(errors)).toBe(true);
	});

	it("surfaces graph_recovery.runaway_retry_loop in the standard validation path", () => {
		const graph = parse(`
	digraph validate_runaway_loop {
		start [shape=Mdiamond]
		retry_a [type="tool" governance="reversible"]
		retry_b [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> retry_a
		retry_a -> retry_b [condition="retry=true"]
		retry_b -> retry_a [condition="retry=true"]
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "graph_recovery.runaway_retry_loop",
				}),
			]),
		);
		expect(hasValidationErrors(errors)).toBe(true);
	});

	it("fails recovery-like nodes without explicit recovery_owner marker", () => {
		const graph = parse(`
	digraph validate_missing_recovery_owner {
		start [shape=Mdiamond]
		gate [shape=diamond]
		supervisor_route [class="supervisor"]
		done [shape=Msquare]

		start -> gate
		gate -> done [condition="judge_pass=true"]
		gate -> supervisor_route [condition="judge_pass!=true"]
		supervisor_route -> done
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "graph_recovery.unowned_failure_path",
					code: RECOVERY_OWNER_MISSING_CODE,
					nodeId: "supervisor_route",
				}),
			]),
		);
		expect(errors.some((error) => error.message.includes("recovery_owner"))).toBe(true);
		expect(hasValidationErrors(errors)).toBe(true);
	});

	it("fails non-recovery-named failure targets without explicit markers", () => {
		const graph = parse(`
	digraph validate_missing_recovery_owner_generic_target {
		start [shape=Mdiamond]
		gate [shape=diamond]
		fallback_route [type="tool" governance="reversible"]
		done [shape=Msquare recovery_sink_type="terminal"]

		start -> gate
		gate -> done [condition="judge_pass=true"]
		gate -> fallback_route [condition="judge_pass!=true"]
		fallback_route -> done
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "graph_recovery.unowned_failure_path",
					code: RECOVERY_OWNER_MISSING_CODE,
					nodeId: "fallback_route",
				}),
			]),
		);
		expect(errors.some((error) => error.message.includes("recovery_owner"))).toBe(true);
		expect(hasValidationErrors(errors)).toBe(true);
	});

	it("keeps explicit recovery markers valid", () => {
		const graph = parse(`
	digraph validate_recovery_ok {
		start [shape=Mdiamond]
		gate [shape=diamond]
		supervisor_route [class="supervisor" recovery_owner="supervisor"]
		done [shape=Msquare recovery_sink_type="terminal"]

		start -> gate
		gate -> done [condition="status=success"]
		gate -> supervisor_route [condition="status=failed"]
		supervisor_route -> done
	}
		`);

		const errors = validate(graph);
		const recoveryErrors = errors.filter((error) => error.rule.startsWith("graph_recovery."));
		expect(recoveryErrors).toEqual([]);
	});
});
