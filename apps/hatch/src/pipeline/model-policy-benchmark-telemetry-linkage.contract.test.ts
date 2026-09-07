import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { resolveModelPolicyTelemetryFields } from "./model-policy-telemetry.js";
import { parse } from "./parse.js";

describe("model policy benchmark telemetry linkage contract", () => {
	it("emits model_policy fields on quality.signal when context carries policy telemetry", async () => {
		const graph = parse(`
	digraph model_policy_linkage_contract {
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

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const ctx = new Context({ factory: "mothership", factory_id: "mothership", repo: "recallnet/astrochicken" });
		ctx.set("__run_id", "run-model-policy-linkage-1");
		ctx.set("prompt_hash", "sha256:model-policy-linkage");
		ctx.set("model_policy_version", "v1");
		ctx.set("model_policy_source", "factories/mothership/factory.config.json");
		ctx.set("model_policy_default_provider", "openrouter");
		ctx.set("model_policy_default_model", "openai/gpt-5.3-codex");
		ctx.set("model_policy_selected_via", "policy_default");
		ctx.set("model_policy_allowed_models", "openai/gpt-5.3-codex");

		const engine = new Engine(graph, registry, { eventBus: bus, context: ctx });
		await engine.run();

		const qualitySignal = events.find((event) => event.kind === "quality.signal" && event.nodeId === "worker");
		expect(qualitySignal).toBeTruthy();

		const requiredPolicyKeys = [
			"model_policy_version",
			"model_policy_source",
			"model_policy_default_provider",
			"model_policy_default_model",
			"model_policy_selected_via",
			"model_policy_allowed_models",
		] as const;

		for (const key of requiredPolicyKeys) {
			expect(String(qualitySignal?.data?.[key] || "").trim().length, `missing ${key}`).toBeGreaterThan(0);
		}
		expect(qualitySignal?.data?.model_policy_selected_via).toBe("node_override");
	});

	it("resolveModelPolicyTelemetryFields returns all expected keys for fully-populated policy context", () => {
		const eventData: Record<string, string> = {
			model_policy_version: "v1",
			model_policy_source: "factories/mothership/factory.config.json",
			model_policy_default_provider: "openrouter",
			model_policy_default_model: "openai/gpt-5.3-codex",
			model_policy_selected_via: "policy_default",
			model_policy_allowed_models: "openai/gpt-5.3-codex",
		};
		const contextMap: Record<string, string> = {
			...eventData,
		};

		const resolved = resolveModelPolicyTelemetryFields({
			eventData,
			context: {
				get(key: string): string {
					return contextMap[key] ?? "";
				},
			},
			nodeAttrs: undefined,
		});

		expect(resolved).toBeTruthy();
		const expectedKeys = [
			"model_policy_version",
			"model_policy_source",
			"model_policy_default_provider",
			"model_policy_default_model",
			"model_policy_selected_via",
			"model_policy_allowed_models",
			"model_policy_policy_pack_dir",
		] as const;

		expect(Object.keys(resolved || {}).sort()).toEqual([...expectedKeys].sort());
		for (const key of expectedKeys) {
			expect(resolved?.[key]).not.toBeUndefined();
		}
		expect(resolved?.model_policy_policy_pack_dir).toBe("");
	});
});
