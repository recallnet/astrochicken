import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "vitest";

import type { FactoryConformanceCommandResult, FactoryConformanceHarnessResult } from "./conformance-harness.js";

export function writeFactoryFixture(options: {
	config: Record<string, unknown>;
	graph: string;
	graphKind?: "dot" | "workflow_source";
	createPolicyPack?: boolean;
	createFactoryIntent?: boolean;
	metadata?: Record<string, unknown>;
	modelPolicy?: Record<string, unknown>;
	benchmarkRegistry?: Record<string, unknown>;
}): { repoRoot: string; factoryRoot: string } {
	const repoRoot = mkdtempSync(path.join(tmpdir(), "factory-conformance-fixture-"));
	const factoryRoot = path.join(repoRoot, "factories", "fixture-factory");
	mkdirSync(path.join(factoryRoot, "graphs"), { recursive: true });
	mkdirSync(path.join(factoryRoot, "conformance"), { recursive: true });
	mkdirSync(path.join(factoryRoot, "skills", "supervisor"), { recursive: true });
	mkdirSync(path.join(factoryRoot, "scenarios", "fixture-factory"), { recursive: true });
	mkdirSync(path.join(repoRoot, "docs", "contracts"), { recursive: true });
	mkdirSync(path.join(repoRoot, "docs", "astrochicken"), { recursive: true });
	writeFileSync(path.join(factoryRoot, "factory.config.json"), `${JSON.stringify(options.config, null, 2)}\n`);
	if (options.graphKind === "workflow_source") {
		const workflowDir = path.join(factoryRoot, "workflows", "dispatch-control");
		const runtimeGraphPath = path.join(repoRoot, "docs", "contracts", "workflow-ir", "fixture", "factory_supervisor_tick.dot");
		mkdirSync(workflowDir, { recursive: true });
		mkdirSync(path.dirname(runtimeGraphPath), { recursive: true });
		writeFileSync(
			path.join(workflowDir, "factory_supervisor_tick.workflow-source.data.json"),
			`${JSON.stringify({
				schemaVersion: "workflow_source_module/v1",
				workflowId: "fixture_factory_supervisor_tick",
				familyId: "fixture",
				title: "Fixture supervisor tick",
				description: "Fixture typed workflow source for conformance tests.",
				sourcePath: "factories/fixture-factory/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
				runtimeGraphPath: "docs/contracts/workflow-ir/fixture/factory_supervisor_tick.dot",
				jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
				graphAttributes: {
					label: "factory_supervisor_tick",
				},
				sourceMap: {
					graphName: "factory_supervisor_tick",
					nodeMappings: [
						{ sourceNodeId: "start", runtimeNodeId: "start" },
						{ sourceNodeId: "build", runtimeNodeId: "build" },
						{ sourceNodeId: "done", runtimeNodeId: "done" },
					],
				},
				invariants: {
					mustPreserve: ["benchmark_job_id", "recovery_owner", "terminal sink"],
					mayNormalize: ["generated runtime DOT formatting"],
				},
				sourceOwnership: {
					canonicalAuthoringSurface: "typed_workflow_source",
					runtimeIr: "generated_dot_runtime_ir",
				},
				nodes: [
					{
						id: "build",
						kind: "llm_prompt",
						title: "Build",
						roleClass: "supervisor",
						dotAttributes: {
							class: "supervisor",
							benchmark_job_id: "supervisor.tick.review",
							prompt_version: "2026-03-09.r1",
							role_version: "1.0.0",
							skill_id: "supervisor.tick",
							recovery_owner: "supervisor",
							label: "Build",
						},
					},
					{
						id: "done",
						kind: "terminal",
						title: "Done",
						dotAttributes: {
							shape: "Msquare",
							recovery_sink_type: "terminal",
							label: "Done",
						},
					},
					{
						id: "start",
						kind: "start",
						title: "Start",
						dotAttributes: {
							shape: "Mdiamond",
							label: "Start",
						},
					},
				],
				edges: [
					{ from: "start", to: "build" },
					{ from: "build", to: "done" },
				],
			}, null, 2)}\n`,
		);
		writeFileSync(
			path.join(workflowDir, "factory_supervisor_tick.workflow-source.mjs"),
			"export {};\n",
		);
		writeFileSync(runtimeGraphPath, options.graph);
	} else {
		writeFileSync(path.join(factoryRoot, "graphs", "factory_supervisor_tick.dot"), options.graph);
	}
	writeFileSync(path.join(factoryRoot, "skills", "supervisor", "current.md"), "# fixture supervisor skill\n");
	writeFileSync(path.join(factoryRoot, "scenarios", "fixture-factory", "README.md"), "# fixture scenario root\n");
	writeFileSync(path.join(repoRoot, "docs", "astrochicken", "astrochicken-platform-intent.md"), "# Platform intent\n");
	if (options.createFactoryIntent !== false) {
		writeFileSync(path.join(factoryRoot, "INTENT.md"), "# Fixture Factory Intent\n");
	}
	writeFileSync(
		path.join(repoRoot, "docs", "contracts", "benchmark-job-registry.json"),
		`${JSON.stringify(options.benchmarkRegistry ?? {
			schema_version: "benchmark_job_registry/v1",
			jobs: [{ job_id: "supervisor.tick.review", description: "fixture benchmark job", nodes: [{ graph: "factory_supervisor_tick.dot", node_id: "build" }] }],
		}, null, 2)}\n`,
	);
	if (options.createPolicyPack !== false) {
		mkdirSync(path.join(factoryRoot, "policy-pack", "v1"), { recursive: true });
		writeFileSync(
			path.join(factoryRoot, "policy-pack", "v1", "metadata.json"),
			`${JSON.stringify(options.metadata ?? {
				version: "v1",
				owned_by: "factory-platform",
				files: { model: "model-policy.json" },
				required_keys: { model: ["shared.default_provider", "shared.default_model", "shared.override_env_vars.provider", "shared.override_env_vars.model"] },
				customizable_keys: { model: ["factory.allowed_models", "factory.preferred_model", "factory.provider_order"] },
			}, null, 2)}\n`,
		);
		writeFileSync(
			path.join(factoryRoot, "policy-pack", "v1", "model-policy.json"),
			`${JSON.stringify(options.modelPolicy ?? {
				shared: {
					default_provider: "openrouter",
					default_model: "openai/gpt-5.3-codex",
					override_env_vars: { provider: "HATCH_MODEL_PROVIDER", model: "HATCH_MODEL" },
				},
				factory: {
					provider_order: ["openrouter"],
					allowed_models: ["openai/gpt-5.3-codex"],
					preferred_model: "openai/gpt-5.3-codex",
				},
			}, null, 2)}\n`,
		);
	}
	return { repoRoot, factoryRoot };
}

export function baseFactoryConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schema: "hatch.factory.config.v1",
		factory_id: "fixture-factory",
		target_repo: "example-org/fixture-factory",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
		skills: { supervisor: "factories/fixture-factory/skills/supervisor/current.md" },
		scenarios: { root: "factories/fixture-factory/scenarios/fixture-factory" },
		pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
		runs_dir: ".hatch/fixture-factory/runs",
		trust: { domain: "fixture-factory.local", roles: ["fixture-factory.local.tool"] },
		policyPack: { version: "v1", overrides: {} },
		...overrides,
	};
}

export function workflowSourceFactoryConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return baseFactoryConfig({
		dispatch: { graph: "workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
		pipeline: { supervisor_tick: "workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
		...overrides,
	});
}

export function assertFailedPhase(result: FactoryConformanceHarnessResult, phase: string): void {
	expect(result.ok).toBe(false);
	expect(result.failed_phase).toBe(phase);
	expect(result.first_failure?.phase).toBe(phase);
}

export function validGraph(): string {
	return `digraph factory_supervisor_tick {
	start [shape=Mdiamond label="Start"]
	build [class="supervisor"
	       benchmark_job_id="supervisor.tick.review"
	       prompt_version="2026-03-09.r1"
	       role_version="1.0.0"
	       skill_id="supervisor.tick"
	       recovery_owner="supervisor"
	       label="Build"]
	done [shape=Msquare recovery_sink_type="terminal" label="Done"]

	start -> build -> done
}
`;
}

export function successfulCommand(command = "mock command"): FactoryConformanceCommandResult {
	return {
		ok: true,
		command,
		stdout: "{}",
		stderr: "",
		exitCode: 0,
		durationMs: 1,
		timedOut: false,
		errorMessage: "",
	};
}

export function logicalCommandArgs(request: { command: string; args: string[] }): string[] {
	if (request.command === process.execPath && request.args[0]?.endsWith("/cli.js")) return request.args.slice(1);
	return request.args;
}
