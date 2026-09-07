import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "../context.js";
import { Engine, HandlerRegistry } from "../engine.js";
import { parse } from "../parse.js";
import { createRunState } from "../run.js";

function mustFind(events: Event[], kind: Event["kind"], nodeId?: string): Event {
	const found = events.find((event) => event.kind === kind && (nodeId ? event.nodeId === nodeId : true));
	if (!found) throw new Error(`missing event ${kind}${nodeId ? ` for ${nodeId}` : ""}`);
	return found;
}

function assertBenchmarkIdentity(event: Event): void {
	const requiredKeys = [
		"factory_id",
		"graph_id",
		"node_id",
		"handler_type",
		"model",
		"provider",
		"prompt_hash",
		"job_id",
		"prompt_version",
		"role_version",
		"skill_id",
		"hatch.job_id",
		"hatch.prompt_version",
		"hatch.role_version",
		"hatch.skill_id",
	] as const;
	const missing = requiredKeys.filter((key) => !String(event.data?.[key] || "").trim());
	if (String(event.data?.model_policy_source || event.data?.model_policy_version || "").trim()) {
		const policyKeys = [
			"model_policy_version",
			"model_policy_source",
			"model_policy_default_provider",
			"model_policy_default_model",
			"model_policy_selected_via",
			"model_policy_allowed_models",
		] as const;
		for (const key of policyKeys) {
			if (!String(event.data?.[key] || "").trim()) {
				missing.push(key);
			}
		}
	}
	if (missing.length > 0) {
		throw new Error(`benchmark_identity_missing keys=${missing.join(",")} kind=${event.kind} node=${event.nodeId || ""}`);
	}
}

describe("runtime langfuse eventbus enrichment", () => {
	it("enriches stage/edge/retry/quality events with universal session+trace metadata", async () => {
		const graph = parse(`
	digraph enrich_stage_retry {
		start [shape=Mdiamond]
		worker [type="tool" tool_id="shell" max_retries="2" llm_model="claude-sonnet-4-6" llm_provider="anthropic" benchmark_job_id="wave.execute.issue.lifecycle" prompt_version="2026-03-09.r1" role_version="1.4.0" skill_id="wave.execute.issue" llm_path_id="mothership.wave.execute.issue"]
		done [shape=Msquare]
		start -> worker -> done
	}
		`);

		let attempts = 0;
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				attempts += 1;
				if (attempts === 1) throw new Error("retry once");
				return { status: StageStatus.Completed, output: "ok" };
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const ctx = new Context({ factory: "mothership", factory_id: "mothership", repo: "recallnet/astrochicken" });
		ctx.set("__run_id", "run-enrich-1");
		ctx.set("prompt_hash", "sha256:wave-execute-r1");
		ctx.set("model_policy_version", "v1");
		ctx.set("model_policy_source", "factories/mothership/factory.config.json");
		ctx.set("model_policy_default_provider", "openrouter");
		ctx.set("model_policy_default_model", "openai/gpt-5.3-codex");
		ctx.set("model_policy_selected_via", "policy_default");
		ctx.set("model_policy_allowed_models", "openai/gpt-5.3-codex");
		const engine = new Engine(graph, registry, { eventBus: bus, context: ctx });
		await engine.run();

		const stageStart = mustFind(events, "stage.start", "worker");
		const stageRetry = mustFind(events, "stage.retry", "worker");
		const stageFinish = mustFind(events, "stage.finish", "worker");
		const edgeSelected = events.find((event) => event.kind === "edge.selected" && event.edgeFrom === "worker");
		if (!edgeSelected) throw new Error("missing edge.selected for worker->done");
		const qualitySignal = mustFind(events, "quality.signal", "worker");

		for (const event of [stageStart, stageRetry, stageFinish, edgeSelected, qualitySignal]) {
			expect(event.traceId).toBeTruthy();
			expect(event.data?.session_id).toBeTruthy();
			expect(event.data?.langfuse_trace_id).toMatch(/^lf_trace_/);
			expect(event.data?.run_id).toBe("run-enrich-1");
			expect(event.data?.graph).toBe("enrich_stage_retry");
			expect(event.data?.graph_id).toBe("enrich_stage_retry");
			expect(event.data?.repo).toBe("recallnet/astrochicken");
			expect(event.data?.factory).toBe("mothership");
			expect(event.data?.factory_id).toBe("mothership");
			expect(event.data?.node_id).toBe("worker");
			expect(event.data?.handler_type).toBe("tool");
			expect(event.data?.model).toBe("claude-sonnet-4-6");
			expect(event.data?.provider).toBe("anthropic");
			expect(event.data?.prompt_hash).toBe("sha256:wave-execute-r1");
			expect(event.data?.model_provider).toBeTruthy();
			// langfuse_* fields removed in phase-2.2; hatch.* aliases are the canonical fields
			expect(event.data?.["hatch.session_id"]).toBeTruthy();
			expect(event.data?.["hatch.attempt"]).toBeTruthy();
			expect(event.data?.job_id).toBe("wave.execute.issue.lifecycle");
			expect(event.data?.prompt_version).toBe("2026-03-09.r1");
			expect(event.data?.role_version).toBe("1.4.0");
			expect(event.data?.skill_id).toBe("wave.execute.issue");
			expect(event.data?.model_policy_version).toBe("v1");
			expect(event.data?.model_policy_source).toBe("factories/mothership/factory.config.json");
			expect(event.data?.model_policy_default_provider).toBe("openrouter");
			expect(event.data?.model_policy_default_model).toBe("openai/gpt-5.3-codex");
			expect(event.data?.model_policy_allowed_models).toBe("openai/gpt-5.3-codex");
			expect(event.data?.model_policy_selected_via).toBe("node_override");
			expect(event.data?.["hatch.session_id"]).toBeTruthy();
			expect(event.data?.["hatch.skill_id"]).toBe("wave.execute.issue");
			expect(event.data?.["hatch.job_id"]).toBe("wave.execute.issue.lifecycle");
			expect(event.data?.["hatch.prompt_version"]).toBe("2026-03-09.r1");
			expect(event.data?.["hatch.role_version"]).toBe("1.4.0");
			expect(event.data?.["hatch.model"]).toBe("claude-sonnet-4-6");
			expect(event.data?.["hatch.provider"]).toBe("anthropic");
			expect(event.data?.["hatch.prompt_hash"]).toBe("sha256:wave-execute-r1");
			expect(event.data?.llm_path_id).toBe("mothership.wave.execute.issue");
			expect(event.data?.["hatch.llm_path_id"]).toBe("mothership.wave.execute.issue");
			expect(event.data?.["hatch.attempt"]).toBeTruthy();
			expect(event.data?.["hatch.tag.factory"]).toBe("mothership");
			expect(event.data?.["hatch.tag.handler_type"]).toBeTruthy();
			expect(event.data?.["hatch.tag.model_provider"]).toBeTruthy();
			expect(event.data?.["hatch.tag.outcome"]).toBeTruthy();
			expect(event.data?.["hatch.abstraction_level"]).toBe("node");
			expect(event.data?.["hatch.phase"]).toBe("worker");
			assertBenchmarkIdentity(event);
		}

		expect(stageStart.data?.attempt).toBe("1");
		expect(stageRetry.data?.attempt).toBe("2");
		expect(stageFinish.data?.attempt).toBe("2");
		expect(stageRetry.data?.session_id).toBe(stageFinish.data?.session_id);
		expect(stageRetry.data?.langfuse_trace_id).toBe(stageFinish.data?.langfuse_trace_id);
		expect(stageFinish.data?.duration_ms).toBeTruthy();
	});

	it("emits benchmark identity violation as warning when semantic identity fields are missing", async () => {
		const graph = parse(`
	digraph benchmark_missing_fields {
		start [shape=Mdiamond]
		worker [type="tool" tool_id="shell" llm_model="claude-sonnet-4-6" llm_provider="anthropic" benchmark_job_id="wave.execute.issue.lifecycle" skill_id="wave.execute.issue"]
		done [shape=Msquare]
		start -> worker -> done
	}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "ok" };
			},
		});
		const allEvents: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => allEvents.push(event));
		const ctx = new Context({ factory_id: "mothership" });
		ctx.set("__run_id", "run-benchmark-missing");
		ctx.set("prompt_hash", "sha256:wave-execute-r1");
		const engine = new Engine(graph, registry, { context: ctx, eventBus: bus });
		await engine.run();
		const stageStart = allEvents.find((event) => event.kind === "stage.start" && event.nodeId === "worker");
		expect(stageStart).toBeTruthy();
		expect(stageStart?.data?.benchmark_identity_violation).toMatch(/benchmark_identity_contract_violation.*prompt_version,role_version/);
	});

	it("emits benchmark identity violation when model policy keys are incomplete", async () => {
		const graph = parse(`
	digraph benchmark_missing_model_policy_fields {
		start [shape=Mdiamond]
		worker [type="tool" tool_id="shell" llm_model="claude-sonnet-4-6" llm_provider="anthropic" benchmark_job_id="wave.execute.issue.lifecycle" prompt_version="2026-03-09.r1" role_version="1.4.0" skill_id="wave.execute.issue"]
		done [shape=Msquare]
		start -> worker -> done
	}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "ok" };
			},
		});
		const allEvents: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => allEvents.push(event));
		const ctx = new Context({ factory_id: "mothership" });
		ctx.set("__run_id", "run-benchmark-policy-missing");
		ctx.set("prompt_hash", "sha256:wave-execute-r1");
		ctx.set("model_policy_source", "factories/mothership/factory.config.json");
		const engine = new Engine(graph, registry, { context: ctx, eventBus: bus });
		await engine.run();
		const stageStart = allEvents.find((event) => event.kind === "stage.start" && event.nodeId === "worker");
		expect(stageStart).toBeTruthy();
		expect(stageStart?.data?.benchmark_identity_violation).toMatch(/benchmark_identity_contract_violation.*model_policy_version/);
	});

	it("enriches guard events before EventBus dispatch", async () => {
		const graph = parse(`
	digraph guard_enrichment {
		start [shape=Mdiamond]
		worker [type="tool" tool_id="shell"]
		done [shape=Msquare]
		start -> worker -> done
	}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "ok" };
			},
		});
		const runState = createRunState("guard-run-enrich", "guard.dot");
		const ctx = new Context({
			guard_factory_scope: "guard-enrich",
			guard_worker_period: "period-1",
			guard_policy_revision: "guard.test.v1",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "0",
			repo: "recallnet/astrochicken",
			factory: "mothership",
		});
		ctx.set("__run_id", runState.runId);

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const engine = new Engine(graph, registry, { eventBus: bus, context: ctx, runState });
		await engine.run();

		const guardTransition = mustFind(events, "guard.transition", "worker");
		expect(guardTransition.traceId).toBeTruthy();
		expect(guardTransition.data?.session_id).toBeTruthy();
		expect(guardTransition.data?.langfuse_trace_id).toMatch(/^lf_trace_/);
		expect(guardTransition.data?.gate_name).toBeTruthy();
		expect(guardTransition.data?.gate_outcome).toBe("fail");
		expect(guardTransition.data?.gate_evidence_ref).toContain("sha256:");
		expect(guardTransition.data?.["hatch.tag.outcome"]).toBe("fail");
	});

	it("emits and enriches parallel fan-out/fan-in events", async () => {
		const graph = parse(`
	digraph parallel_enrichment {
		start [shape=Mdiamond]
		fan [type="parallel.fan_out"]
		join [type="parallel.fan_in"]
		done [shape=Msquare]
		start -> fan -> join -> done
	}
		`);
		const registry = new HandlerRegistry();
		registry.register("parallel.fan_out", {
			async execute(_signal, _node, _ctx, input) {
				return { status: StageStatus.Completed, output: input || "fan" };
			},
		});
		registry.register("parallel.fan_in", {
			async execute(_signal, _node, _ctx, input) {
				return { status: StageStatus.Completed, output: input || "join" };
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const ctx = new Context({ factory: "mothership", repo: "recallnet/astrochicken" });
		ctx.set("__run_id", "parallel-run-enrich");
		const engine = new Engine(graph, registry, { eventBus: bus, context: ctx });
		await engine.run();

		const fanOut = mustFind(events, "parallel.fan_out", "fan");
		const fanIn = mustFind(events, "parallel.fan_in", "join");
		for (const event of [fanOut, fanIn]) {
			expect(event.traceId).toBeTruthy();
			expect(event.data?.session_id).toBeTruthy();
			expect(event.data?.langfuse_trace_id).toMatch(/^lf_trace_/);
			expect(event.data?.handler_type).toMatch(/^parallel\./);
			expect(event.data?.["hatch.tag.handler_type"]).toMatch(/^parallel\./);
			expect(event.data?.["hatch.tag.outcome"]).toBe("parallel");
		}
	});
});
