import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";

const SUPERVISOR_TICK_DOT = join(import.meta.dirname, "../../../../docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const DISPATCH_REACTOR_DOT = join(import.meta.dirname, "../../../../factories/mothership/graphs/factory_dispatch_reactor.dot");

describe("mothership dispatch ownership topology contract", () => {
	it("keeps executable-goal dispatch out of the supervisor tick", () => {
		const graph = parse(readFileSync(SUPERVISOR_TICK_DOT, "utf8"));

		expect(graph.nodes.list_executable_goals).toBeUndefined();
		expect(graph.nodes.goal_execute_gate).toBeUndefined();
		expect(graph.nodes.spawn_goal_execute).toBeUndefined();
		expect(graph.nodes.stamp_factory_contract_hash).toBeUndefined();
		expect(graph.edges.some((edge) => edge.to === "spawn_goal_execute")).toBe(false);
		expect(graph.edges.some((edge) => edge.from === "goal_execute_gate")).toBe(false);
		expect(graph.edges.some((edge) => edge.from === "emit_disposition_feedback" && edge.to === "emit_review_metrics_summary")).toBe(true);
	});

	it("moves executable-goal dispatch into the narrow reactor graph", () => {
		const graph = parse(readFileSync(DISPATCH_REACTOR_DOT, "utf8"));

		expect(graph.nodes.artifact_ingest?.attrs.pipeline).toBe("packages/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs");
		expect(graph.nodes.auto_ready_artifact_goals?.attrs.action_id).toBe("goal.auto_ready_artifacts");
		expect(graph.nodes.sanitize_goal_duplicates?.attrs.action_id).toBe("goal.sanitize_duplicates");
		expect(graph.nodes.sweep_completed_goals?.attrs.action_id).toBe("goal.sweep_completed");
		expect(graph.nodes.release_quarantine?.attrs.action_id).toBe("wave.release_quarantine");
		expect(graph.nodes.resolve_dispatch_retry_backoff_seconds?.attrs.action_id).toBe("common.resolve_default");
		expect(graph.nodes.list_executable_goals?.attrs.action_id).toBe("software.list_executable_goals");
		expect(graph.nodes.goal_execute_gate?.attrs.shape).toBe("diamond");
		expect(graph.nodes.stamp_factory_contract_hash?.attrs.action_id).toBe("factory.stamp_contract_hash");
		expect(graph.nodes.spawn_goal_execute?.attrs.type).toBe("fan_out.detached");
		expect(graph.nodes.spawn_goal_execute?.attrs.template).toBe("factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs");
		expect(graph.edges.some((edge) => edge.from === "goal_execute_gate" && edge.to === "stamp_factory_contract_hash" && edge.attrs.condition === "count!=0")).toBe(true);
		expect(graph.edges.some((edge) => edge.from === "goal_execute_gate" && edge.to === "done" && edge.attrs.condition === "count=0")).toBe(true);
		expect(graph.edges.some((edge) => edge.from === "stamp_factory_contract_hash" && edge.to === "spawn_goal_execute")).toBe(true);
	});

	it("keeps the dispatch reactor narrow and free of maintenance/review concerns", () => {
		const graph = parse(readFileSync(DISPATCH_REACTOR_DOT, "utf8"));

		for (const forbiddenNode of [
			"release_manifest",
			"emit_disposition_feedback",
			"snapshot_state",
			"supervisor_review",
		]) {
			expect(graph.nodes[forbiddenNode], `dispatch reactor must not own ${forbiddenNode}`).toBeUndefined();
		}
	});
});
