import { describe, expect, it } from "vitest";

import { validateGraphRecoveryInvariants } from "./graph-recovery-invariants.js";
import { parse } from "./parse.js";
import { RECOVERY_OWNER_MISSING_CODE } from "./recovery-contract.js";

function expectRule(
	errors: ReturnType<typeof validateGraphRecoveryInvariants>,
	rule: string,
	nodeId?: string,
	code?: string,
): void {
	expect(errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				rule,
				...(nodeId ? { nodeId } : {}),
				...(code ? { code } : {}),
			}),
		]),
	);
}

describe("graph recovery invariants", () => {
	it("passes when failure paths converge through explicit recovery ownership", () => {
		const graph = parse(`
	digraph recovery_ok {
		start [shape=Mdiamond]
		work [type="tool"]
		failure_gate [shape=diamond]
		supervisor_review [class="supervisor" recovery_owner="supervisor"]
		done [shape=Msquare recovery_sink_type="terminal"]

		start -> work -> failure_gate
		failure_gate -> done [condition="outcome=success"]
		failure_gate -> supervisor_review [condition="outcome=failed"]
		supervisor_review -> done
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expect(errors).toEqual([]);
	});

	it("fails when a supervisor-like recovery node has no explicit owner marker", () => {
		const graph = parse(`
	digraph recovery_missing_owner {
		start [shape=Mdiamond]
		failure_gate [shape=diamond]
		supervisor_review [class="supervisor"]
		done [shape=Msquare]

		start -> failure_gate
		failure_gate -> supervisor_review [condition="outcome=failed"]
		supervisor_review -> done
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expectRule(errors, "graph_recovery.unowned_failure_path", "supervisor_review", RECOVERY_OWNER_MISSING_CODE);
		expect(errors.some((error) => error.message.includes("recovery_owner"))).toBe(true);
	});

	it("fails non-recovery-named failure targets without explicit ownership or sink markers", () => {
		const graph = parse(`
	digraph recovery_missing_owner_generic_target {
		start [shape=Mdiamond]
		failure_gate [shape=diamond]
		fallback_step [type="tool"]
		done [shape=Msquare recovery_sink_type="terminal"]

		start -> failure_gate
		failure_gate -> done [condition="outcome=success"]
		failure_gate -> fallback_step [condition="outcome=failed"]
		fallback_step -> done
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expectRule(errors, "graph_recovery.unowned_failure_path", "fallback_step", RECOVERY_OWNER_MISSING_CODE);
		expect(errors.some((error) => error.message.includes("recovery_owner"))).toBe(true);
	});

	it("reports dead-end operational nodes", () => {
		const graph = parse(`
	digraph dead_end {
		start [shape=Mdiamond]
		build [type="tool"]
		done [shape=Msquare]

		start -> build
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expectRule(errors, "graph_recovery.dead_end", "build");
	});

	it("reports unowned failure branches", () => {
		const graph = parse(`
	digraph unowned_failure {
		start [shape=Mdiamond]
		check [shape=diamond]
		spin [type="tool"]
		done [shape=Msquare]

		start -> check
		check -> done [condition="judge_pass=true"]
		check -> spin [condition="judge_pass!=true"]
		spin -> spin [loop_restart="true"]
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expectRule(errors, "graph_recovery.unowned_failure_path", "check");
	});

	it("reports runaway retry loops without recovery escape", () => {
		const graph = parse(`
	digraph runaway_loop {
		start [shape=Mdiamond]
		retry_a [type="tool"]
		retry_b [type="tool"]
		done [shape=Msquare]

		start -> retry_a
		retry_a -> retry_b [condition="retry=true"]
		retry_b -> retry_a [condition="retry=true"]
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expectRule(errors, "graph_recovery.runaway_retry_loop");
	});

	it("accepts approved external wait states", () => {
		const graph = parse(`
	digraph wait_ok {
		start [shape=Mdiamond]
		wait_human [type="wait.human"]

		start -> wait_human
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expect(errors).toEqual([]);
	});

	it("accepts explicit success/failure terminals", () => {
		const graph = parse(`
	digraph terminals_ok {
		start [shape=Mdiamond]
		gate [shape=diamond]
		success [type="exit.success" terminal_kind="success" recovery_sink_type="terminal"]
		failure [type="exit.failure" terminal_kind="failure" recovery_sink_type="terminal"]

		start -> gate
		gate -> success [condition="pass=true"]
		gate -> failure [condition="pass!=true"]
	}
		`);

		const errors = validateGraphRecoveryInvariants(graph);
		expect(errors).toEqual([]);
	});
});
