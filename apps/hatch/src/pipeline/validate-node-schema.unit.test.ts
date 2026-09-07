import { describe, expect, it } from "vitest";

import { NODE_SCHEMA_RULE_CODES } from "./node-schema.js";
import { parse } from "./parse.js";
import { validate } from "./validate.js";

function errorsWithRule(errors: { rule: string; code?: string; nodeId?: string }[], rule: string) {
	return errors.filter((e) => e.rule === rule);
}

function errorsWithCode(errors: { rule: string; code?: string; nodeId?: string }[], code: string) {
	return errors.filter((e) => e.code === code);
}

describe("node schema: boolean attribute validation", () => {
	it("accepts valid boolean values", () => {
		const graph = parse(`
	digraph valid_booleans {
		start [shape=Mdiamond]
		ingest [type="pipeline" prompt="ingest.dot" fail_open="true"]
		gate [shape=diamond goal_gate="true"]
		done [shape=Msquare]

		start -> ingest -> gate
		gate -> done [condition="outcome=success"]
		gate -> done [condition="outcome=failure"]
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
		expect(errors).toHaveLength(0);
	});

	it("rejects non-boolean values on boolean attributes", () => {
		const graph = parse(`
	digraph bad_booleans {
		start [shape=Mdiamond]
		ingest [type="pipeline" prompt="ingest.dot" fail_open="tru"]
		done [shape=Msquare]

		start -> ingest -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			nodeId: "ingest",
			code: NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID,
		});
	});

	it("rejects multiple bad booleans on the same node", () => {
		const graph = parse(`
	digraph multi_bad_bool {
		start [shape=Mdiamond]
		runner [type="tool" prompt="echo hi" governance="reversible" fail_open="yes" auto_status="1"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID);
		expect(errors).toHaveLength(2);
		expect(errors.map((e) => e.nodeId)).toEqual(["runner", "runner"]);
	});
});

describe("node schema: enum attribute validation", () => {
	it("accepts valid governance values", () => {
		const graph = parse(`
	digraph valid_governance {
		start [shape=Mdiamond]
		runner [type="tool" prompt="echo ok" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
		expect(errors).toHaveLength(0);
	});

	it("rejects misspelled governance values", () => {
		const graph = parse(`
	digraph bad_governance {
		start [shape=Mdiamond]
		runner [type="tool" prompt="echo ok" governance="reversble"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "runner" });
		expect(errors[0].message).toContain("governance");
		expect(errors[0].message).toContain("reversble");
	});

	it("rejects invalid recovery_sink_type values", () => {
		const graph = parse(`
	digraph bad_sink {
		start [shape=Mdiamond]
		sink [type="tool" prompt="echo ok" governance="irreversible" recovery_owner="supervisor" recovery_sink_type="finalize"]
		done [shape=Msquare]

		start -> sink -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("recovery_sink_type");
	});

	it("rejects invalid reasoning_effort values", () => {
		const graph = parse(`
	digraph bad_effort {
		start [shape=Mdiamond]
		agent [type="agent.worktree" repo="\${repo}" branch="fix" prompt="fix it" reasoning_effort="maximum"]
		done [shape=Msquare]

		start -> agent -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.ENUM_INVALID);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("reasoning_effort");
	});
});

describe("node schema: cross-attribute constraints", () => {
	it("warns when governance is irreversible without recovery_owner", () => {
		const graph = parse(`
	digraph no_recovery {
		start [shape=Mdiamond]
		dangerous [type="tool" prompt="rm -rf /" governance="irreversible"]
		done [shape=Msquare]

		start -> dangerous -> done
	}
		`);
		const warnings = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.IRREVERSIBLE_WITHOUT_RECOVERY_OWNER);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ nodeId: "dangerous", severity: "warning" });
	});

	it("passes when irreversible has recovery_owner", () => {
		const graph = parse(`
	digraph with_recovery {
		start [shape=Mdiamond]
		dangerous [type="tool" prompt="rm -rf /" governance="irreversible" recovery_owner="supervisor"]
		done [shape=Msquare]

		start -> dangerous -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.IRREVERSIBLE_WITHOUT_RECOVERY_OWNER);
		expect(errors).toHaveLength(0);
	});

	it("rejects fail_open on exit nodes", () => {
		const graph = parse(`
	digraph fail_open_exit {
		start [shape=Mdiamond]
		done [shape=Msquare fail_open="true"]

		start -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_EXIT);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "done" });
	});

	it("rejects fail_open on start nodes", () => {
		const graph = parse(`
	digraph fail_open_start {
		start [shape=Mdiamond fail_open="true"]
		done [shape=Msquare]

		start -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_STRUCTURAL);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "start" });
	});

	it("rejects fail_open on conditional nodes", () => {
		const graph = parse(`
	digraph fail_open_cond {
		start [shape=Mdiamond]
		gate [shape=diamond fail_open="true"]
		a [type="tool" prompt="echo a" governance="reversible"]
		done [shape=Msquare]

		start -> gate
		gate -> a [condition="outcome=success"]
		gate -> done [condition="outcome=failure"]
		a -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_STRUCTURAL);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "gate" });
	});
});

describe("node schema: per-type required attributes", () => {
	it("requires prompt on pipeline nodes", () => {
		const graph = parse(`
	digraph no_prompt_pipeline {
		start [shape=Mdiamond]
		sub [type="pipeline"]
		done [shape=Msquare]

		start -> sub -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "sub" });
		expect(errors[0].message).toContain("prompt");
	});

	it("accepts pipeline with prompt", () => {
		const graph = parse(`
	digraph good_pipeline {
		start [shape=Mdiamond]
		sub [type="pipeline" prompt="sub.dot"]
		done [shape=Msquare]

		start -> sub -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
		expect(errors).toHaveLength(0);
	});

	it("accepts pipeline with pipeline attribute instead of prompt", () => {
		const graph = parse(`
	digraph pipeline_attr {
		start [shape=Mdiamond]
		sub [type="pipeline" pipeline="sub.dot"]
		done [shape=Msquare]

		start -> sub -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
		expect(errors).toHaveLength(0);
	});

	it("requires template and source_key on fan_out.dynamic nodes", () => {
		const graph = parse(`
	digraph no_template {
		start [shape=Mdiamond]
		fan [type="fan_out.dynamic"]
		done [shape=Msquare]

		start -> fan -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
		expect(errors.length).toBeGreaterThanOrEqual(2);
		const missingAttrs = errors.map((e) => e.message).join(" ");
		expect(missingAttrs).toContain("template");
		expect(missingAttrs).toContain("source_key");
	});

	it("requires prompt on tool nodes", () => {
		const graph = parse(`
	digraph no_prompt_tool {
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "runner" });
		expect(errors[0].message).toContain("prompt");
	});

	it("accepts tool with prompt_source instead of prompt", () => {
		const graph = parse(`
	digraph tool_prompt_source {
		start [shape=Mdiamond]
		runner [type="tool" prompt_source="\${cmd}" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING)
			.filter((e) => e.nodeId === "runner");
		expect(errors).toHaveLength(0);
	});

	it("accepts tool with action_runtime=in_process and action_id", () => {
		const graph = parse(`
	digraph tool_in_process {
		start [shape=Mdiamond]
		runner [type="tool" action_runtime="in_process" action_id="context.capture" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const requiredErrors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING)
			.filter((e) => e.nodeId === "runner");
		const actionErrors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.IN_PROCESS_TOOL_REQUIRES_ACTION_ID)
			.filter((e) => e.nodeId === "runner");
		expect(requiredErrors).toHaveLength(0);
		expect(actionErrors).toHaveLength(0);
	});

	it("requires action_id for tool nodes opting into in-process actions", () => {
		const graph = parse(`
	digraph tool_in_process_missing_action {
		start [shape=Mdiamond]
		runner [type="tool" action_runtime="in_process" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.IN_PROCESS_TOOL_REQUIRES_ACTION_ID);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "runner" });
	});
});

describe("node schema: integer attribute validation", () => {
	it("rejects non-integer max_retries", () => {
		const graph = parse(`
	digraph bad_retries {
		start [shape=Mdiamond]
		runner [type="tool" prompt="echo ok" governance="reversible" max_retries="three"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.INTEGER_INVALID);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ nodeId: "runner" });
		expect(errors[0].message).toContain("max_retries");
	});

	it("rejects non-integer max_concurrency", () => {
		const graph = parse(`
	digraph bad_concurrency {
		start [shape=Mdiamond]
		fan [type="fan_out.dynamic" template="item.dot" source_key="items" item_key="item" max_concurrency="lots"]
		done [shape=Msquare]

		start -> fan -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.INTEGER_INVALID);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("max_concurrency");
	});

	it("accepts valid integer attributes", () => {
		const graph = parse(`
	digraph good_ints {
		start [shape=Mdiamond]
		runner [type="tool" prompt="echo ok" governance="reversible" max_retries="3"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.INTEGER_INVALID);
		expect(errors).toHaveLength(0);
	});

	it("accepts template variable placeholders for integer attributes", () => {
		// Design template files use {{...}} placeholders that are resolved at factory init time.
		// The schema validator must not reject them as invalid integers.
		const graph = parse(`
	digraph template_graph {
		start [shape=Mdiamond]
		coder [type="agent.worktree" repo="owner/repo" branch="main"
		       governance="irreversible" recovery_owner="supervisor"
		       max_retries="{{retry.coder_max_attempts}}"
		       prompt="Implement the task." trust_domain="factory.local" trust_role="factory.local.agent.worktree"]
		done [shape=Msquare]

		start -> coder -> done
	}
		`);
		const errors = errorsWithCode(validate(graph), NODE_SCHEMA_RULE_CODES.INTEGER_INVALID);
		expect(errors).toHaveLength(0);
	});
});

describe("node schema: comprehensive clean graph passes", () => {
	it("validates a realistic supervisor tick graph with no schema errors", () => {
		const graph = parse(`
	digraph supervisor_tick {
		start [shape=Mdiamond]

		control_gate [shape=diamond]
		lease_check [type="tool" prompt="check-lease.sh" governance="reversible" output_key="lease_acquired"]
		ingest [type="pipeline" prompt="ingest.dot" fail_open="true"]
		execute [type="pipeline" prompt="execute.dot"]
		review [type="pipeline" prompt="review.dot" fail_open="true"]
		done [shape=Msquare]

		start -> control_gate
		control_gate -> lease_check [condition="should_run=true"]
		control_gate -> done [condition="should_run=false"]
		lease_check -> ingest -> execute -> review -> done
	}
		`);

		const schemaErrors = validate(graph).filter(
			(e) => e.code && Object.values(NODE_SCHEMA_RULE_CODES).includes(e.code as string),
		);
		expect(schemaErrors).toHaveLength(0);
	});
});
