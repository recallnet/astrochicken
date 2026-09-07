import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	FACTORY_CONFORMANCE_PHASES,
	runFactoryConformanceHarness,
	type FactoryConformancePhase,
} from "./conformance-harness.js";
import {
	assertFailedPhase,
	baseFactoryConfig,
	logicalCommandArgs,
	successfulCommand,
	validGraph,
	workflowSourceFactoryConfig,
	writeFactoryFixture,
} from "./conformance-harness.test-support.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRootForTests = path.resolve(__dirname, "../../../../");

describe("runFactoryConformanceHarness", () => {
	it("exposes canonical deterministic phase order", () => {
		expect(FACTORY_CONFORMANCE_PHASES).toEqual([
			"config_schema",
			"intent_stack",
			"policy_pack_conformance",
			"graph_validate",
			"dot_lint",
			"recovery_ownership",
			"benchmark_telemetry",
			"run_dir_isolation",
			"skill_loading",
			"scenario_root",
			"supervisor_tick_smoke",
			"operational_e2e",
			"ops_contract",
		]);
	});

	it("fails config_schema when factory config is invalid", async () => {
		const fixture = writeFactoryFixture({
			config: {
				schema: "hatch.factory.config.v1",
				factory_id: "fixture-factory",
				pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
			},
			graph: "digraph x { start [shape=Mdiamond]; done [shape=Msquare]; start -> done }\n",
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema"],
		});

		assertFailedPhase(result, "config_schema");
		expect(result.phases).toHaveLength(1);
		expect(result.phases[0]?.error).toContain("factory config schema validation failed");
	});

	it("passes policy_pack_conformance for valid policy packs", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "policy_pack_conformance"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "policy_pack_conformance");
		expect(phase?.ok).toBe(true);
		expect(phase?.details["issue_count"]).toBe(0);
		expect(String(phase?.details["policy_pack_dir"] || "")).toContain("policy-pack/v1");
	});

	it("passes intent_stack when factory and platform intent are runtime-loadable", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: repoRootForTests,
			commandRunner(request) {
				const commandText = `${request.command} ${request.args.join(" ")}`;
				if (request.args[0] === "common" && request.args[1] === "resolve-intent-stack") {
					return {
						...successfulCommand(commandText),
						stdout: JSON.stringify({
							platform_intent_path: path.join(fixture.repoRoot, "docs", "astrochicken", "astrochicken-platform-intent.md"),
							factory_intent_path: path.join(fixture.factoryRoot, "INTENT.md"),
							factory_id: "fixture-factory",
							target_repo: "example-org/fixture-factory",
						}),
					};
				}
				return successfulCommand(commandText);
			},
			phases: ["config_schema", "intent_stack"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "intent_stack");
		expect(phase?.ok).toBe(true);
		expect(String(phase?.details["factory_intent_path"] || "")).toContain("INTENT.md");
	});

	it("fails intent_stack when factory INTENT.md is missing", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
			createFactoryIntent: false,
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: repoRootForTests,
			commandRunner(request) {
				const commandText = `${request.command} ${request.args.join(" ")}`;
				if (request.args[0] === "common" && request.args[1] === "resolve-intent-stack") {
					return {
						ok: false,
						command: commandText,
						stdout: "",
						stderr: `unable_to_read_factory_intent:${path.join(fixture.factoryRoot, "INTENT.md")}: ENOENT`,
						exitCode: 1,
						durationMs: 1,
						timedOut: false,
						errorMessage: "command exited with status 1",
					};
				}
				return successfulCommand(commandText);
			},
			phases: ["config_schema", "intent_stack"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "intent_stack");
		expect(result.first_failure?.error).toContain("intent stack resolution failed");
	});

	it("fails policy_pack_conformance when required key is missing", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
			metadata: {
				version: "v1",
				owned_by: "factory-platform",
				files: {
					model: "model-policy.json",
				},
				required_keys: {
					model: [
						"shared.default_provider",
						"shared.default_model",
						"shared.override_env_vars.provider",
						"shared.override_env_vars.model",
						"shared.missing_required_key",
					],
				},
				customizable_keys: {
					model: [
						"factory.allowed_models",
						"factory.preferred_model",
						"factory.provider_order",
					],
				},
			},
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "policy_pack_conformance"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "policy_pack_conformance");
		const phase = result.phases.find((entry) => entry.phase === "policy_pack_conformance");
		expect(phase?.details["issue_count"]).toBe(1);
		expect(Array.isArray(phase?.details["issues"])).toBe(true);
		expect(phase?.error).toContain("policyPack.model: required key missing: \"shared.missing_required_key\"");
	});

	it("skips policy_pack_conformance when policy-pack directory is absent", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
			createPolicyPack: false,
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "policy_pack_conformance"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "policy_pack_conformance");
		expect(phase?.ok).toBe(true);
		expect(phase?.details["skipped"]).toBe(true);
		expect(phase?.details["reason"]).toBe("no_policy_pack_dir");
	});

	it("fails recovery_ownership and reports missing node ids", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond]
	work [label="Work"]
	done [shape=Msquare]

	start -> work -> done
}
`,
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "graph_validate", "recovery_ownership"],
		});

		assertFailedPhase(result, "recovery_ownership");
		const failed = result.phases.find((phase) => phase.phase === "recovery_ownership");
		expect(failed?.details["missing_node_ids"]).toBeDefined();
		expect(Array.isArray(failed?.details["missing_node_ids"])).toBe(true);
		expect(failed?.details["missing_node_ids"]).toContain("work");
	});

	it("fails benchmark_telemetry when an LLM node is missing required benchmark attributes", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond label="Start"]
	review [class="supervisor" label="Review" recovery_owner="supervisor"]
	done [shape=Msquare recovery_sink_type="terminal" label="Done"]

	start -> review -> done
}
`,
			benchmarkRegistry: {
				schema_version: "benchmark_job_registry/v1",
				jobs: [
					{
						job_id: "supervisor.tick.review",
						description: "fixture benchmark job",
						nodes: [{ graph: "factory_supervisor_tick.dot", node_id: "review" }],
					},
				],
			},
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "graph_validate", "benchmark_telemetry"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "benchmark_telemetry");
		const failed = result.phases.find((phase) => phase.phase === "benchmark_telemetry");
		expect(failed?.details["error_count"]).toBeGreaterThan(0);
		expect(Array.isArray(failed?.details["violations"])).toBe(true);
		expect(JSON.stringify(failed?.details["violations"] || [])).toContain("review");
	});

	it("passes benchmark_telemetry for annotated LLM nodes with registered benchmark_job_id", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond label="Start"]
	review [class="supervisor"
	        benchmark_job_id="supervisor.tick.review"
	        prompt_version="2026-03-09.r1"
	        role_version="1.0.0"
	        skill_id="supervisor.tick"
	        recovery_owner="supervisor"
	        label="Review"]
	done [shape=Msquare recovery_sink_type="terminal" label="Done"]

	start -> review -> done
}
`,
			benchmarkRegistry: {
				schema_version: "benchmark_job_registry/v1",
				jobs: [
					{
						job_id: "supervisor.tick.review",
						description: "fixture benchmark job",
						nodes: [{ graph: "factory_supervisor_tick.dot", node_id: "review" }],
					},
				],
			},
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "graph_validate", "benchmark_telemetry"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "benchmark_telemetry");
		expect(phase?.ok).toBe(true);
		expect(phase?.details["error_count"]).toBe(0);
	});

	it("fails run_dir_isolation when resolved runs dir is not factory scoped", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig({
				runs_dir: ".hatch/runs",
				isolation: {
					paths: {
						runs: ".hatch/runs",
					},
				},
			}),
			graph: `digraph factory_supervisor_tick {
	start [shape=Mdiamond]
	work [recovery_owner="supervisor" label="Work"]
	done [shape=Msquare recovery_sink_type="terminal"]

	start -> work -> done
}
`,
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "graph_validate", "recovery_ownership", "benchmark_telemetry", "run_dir_isolation"],
		});

		assertFailedPhase(result, "run_dir_isolation");
		expect(result.first_failure?.error).toContain("resolved runs dir must end with");
	});

	it("fails run_dir_isolation when resolved runs dir is inside factory root", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig({
				runs_dir: "factories/fixture-factory/.hatch/fixture-factory/runs",
				isolation: {
					paths: {
						runs: "factories/fixture-factory/.hatch/fixture-factory/runs",
					},
				},
			}),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "graph_validate", "recovery_ownership", "benchmark_telemetry", "run_dir_isolation"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "run_dir_isolation");
		expect(result.first_failure?.error).toContain("must not be inside factory root");
	});

	it("passes skill_loading when skills.supervisor resolves to an existing file", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "skill_loading"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "skill_loading");
		expect(phase?.ok).toBe(true);
		expect(String(phase?.details["skill_path"] || "")).toContain("skills/supervisor/current.md");
	});

	it("fails skill_loading when skills.supervisor path is missing", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig({
				skills: { supervisor: "factories/fixture-factory/skills/supervisor/missing.md" },
			}),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "skill_loading"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "skill_loading");
		const phase = result.phases.find((entry) => entry.phase === "skill_loading");
		expect(phase?.error).toContain("skills.supervisor must reference an existing file");
		expect(phase?.details["skill_path"]).toBe("factories/fixture-factory/skills/supervisor/missing.md");
		expect(String(phase?.details["resolved_path"] || "")).toContain("skills/supervisor/missing.md");
	});

	it("passes scenario_root when scenarios.root resolves to an existing directory", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "scenario_root"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "scenario_root");
		expect(phase?.ok).toBe(true);
		expect(String(phase?.details["scenarios_root"] || "")).toContain("scenarios/fixture-factory");
	});

	it("fails scenario_root when scenarios.root path is missing", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig({
				scenarios: { root: "factories/fixture-factory/scenarios/missing-root" },
			}),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			phases: ["config_schema", "scenario_root"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "scenario_root");
		const phase = result.phases.find((entry) => entry.phase === "scenario_root");
		expect(phase?.error).toContain("scenarios.root must reference an existing directory");
		expect(phase?.details["scenarios_root"]).toBe("factories/fixture-factory/scenarios/missing-root");
		expect(String(phase?.details["resolved_path"] || "")).toContain("scenarios/missing-root");
	});

	it("runs full healthy phase chain with deterministic order", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const phaseEvents: Array<{ phase: FactoryConformancePhase; action: "run" | "result"; command?: string }> = [];
		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: repoRootForTests,
			commandRunner(request) {
				const commandText = `${request.command} ${request.args.join(" ")}`;
				const args = logicalCommandArgs(request);
				if (request.args.some((arg) => String(arg).includes("lint-dot.mjs"))) {
					return {
						...successfulCommand(commandText),
						stdout: "[]\n",
						stderr: "[lint-dot] result=ok target=\"fixture\" diagnostics=0 errors=0 warnings=0\n",
					};
				}

				if (args[0] === "common" && args[1] === "resolve-intent-stack") {
					return {
						...successfulCommand(commandText),
						stdout: JSON.stringify({
							platform_intent_path: path.join(fixture.repoRoot, "docs", "astrochicken", "astrochicken-platform-intent.md"),
							factory_intent_path: path.join(fixture.factoryRoot, "INTENT.md"),
							factory_id: "fixture-factory",
							target_repo: "example-org/fixture-factory",
						}),
					};
				}

				const isSmokeRun = args[0] === "run";
				if (isSmokeRun) {
					const runIdIndex = args.indexOf("--run-id");
					const runId = runIdIndex >= 0 ? String(args[runIdIndex + 1] || "") : "";
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					if (runId && runsDir) {
						const runDir = path.join(runsDir, runId);
						mkdirSync(runDir, { recursive: true });
						writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ runId, status: "completed" }, null, 2));
					}
					return successfulCommand(commandText);
				}

				if (request.args[0] === "factory" && request.args[1] === "status") {
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					const activeIds = runsDir && existsSync(runsDir)
						? readdirSync(runsDir).filter((entry) => existsSync(path.join(runsDir, entry, "state.json")))
						: [];
					return {
						...successfulCommand(commandText),
						stdout: JSON.stringify({
							active: activeIds.map((id) => ({ run_id: id })),
						}),
					};
				}

				if (request.args[0] === "factory" && request.args[1] === "tick-status") {
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					const tickIds = runsDir && existsSync(runsDir)
						? readdirSync(runsDir).filter((entry) => existsSync(path.join(runsDir, entry, "state.json")))
						: [];
					return {
						...successfulCommand(commandText),
						stdout: JSON.stringify({
							ticks: tickIds.map((id) => ({ id })),
						}),
					};
				}

				if (request.args.includes("factory") || request.args.includes("recovery-sweep")) {
					return {
						...successfulCommand(commandText),
						stdout: "{}",
					};
				}

				return successfulCommand(commandText);
			},
			onPhaseEvent(event) {
				phaseEvents.push({
					phase: event.phase,
					action: event.action,
					...(event.command ? { command: event.command } : {}),
				});
			},
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
		expect(result.first_failure).toBeNull();
		expect(result.phases.map((phase) => phase.phase)).toEqual([...FACTORY_CONFORMANCE_PHASES]);
		expect(result.phases.every((phase) => phase.ok)).toBe(true);

		const runEvents = phaseEvents.filter((event) => event.action === "run").map((event) => event.phase);
		expect(runEvents).toEqual([...FACTORY_CONFORMANCE_PHASES]);

		const runEventByPhase = new Map(
			phaseEvents
				.filter((event) => event.action === "run")
				.map((event) => [event.phase, event] as const),
		);
		expect(runEventByPhase.get("dot_lint")?.command).toContain("lint-dot.mjs");
		expect(runEventByPhase.get("intent_stack")?.command).toContain("hatch-ops common resolve-intent-stack");
		expect(runEventByPhase.get("supervisor_tick_smoke")?.command).toContain("hatch run");
		expect(runEventByPhase.get("operational_e2e")?.command).toContain("hatch-ops factory status");
		expect(runEventByPhase.get("ops_contract")?.command).toContain("hatch-ops factory status");
	});

	it("skips dot_lint when lint script is missing and skipMissingLintScript=true", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});
		const lintScriptPath = path.join(fixture.repoRoot, "scripts", "lint-dot.mjs");
		const phaseEvents: Array<{ phase: FactoryConformancePhase; action: "run" | "result"; command?: string }> = [];

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: fixture.repoRoot,
			lintScriptPath,
			skipMissingLintScript: true,
			phases: ["config_schema", "graph_validate", "dot_lint"],
			onPhaseEvent(event) {
				phaseEvents.push({
					phase: event.phase,
					action: event.action,
					...(event.command ? { command: event.command } : {}),
				});
			},
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
		const dotLint = result.phases.find((phase) => phase.phase === "dot_lint");
		expect(dotLint?.ok).toBe(true);
		expect(dotLint?.details["skipped"]).toBe(true);
		expect(dotLint?.details["reason"]).toBe("lint_script_not_found");
		expect(dotLint?.details["lint_script_path"]).toBe(lintScriptPath);

		const runDotLintEvent = phaseEvents.find((event) => event.action === "run" && event.phase === "dot_lint");
		expect(runDotLintEvent?.command).toContain(lintScriptPath);
	});

	it("passes --strict-warnings to dot_lint when strict warning mode is enabled", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});
		const phaseEvents: Array<{ phase: FactoryConformancePhase; action: "run" | "result"; command?: string }> = [];

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: repoRootForTests,
			dotLintStrictWarnings: true,
			commandRunner(request) {
				return successfulCommand(`${request.command} ${request.args.join(" ")}`);
			},
			phases: ["config_schema", "graph_validate", "dot_lint"],
			onPhaseEvent(event) {
				phaseEvents.push({
					phase: event.phase,
					action: event.action,
					...(event.command ? { command: event.command } : {}),
				});
			},
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const runDotLintEvent = phaseEvents.find((event) => event.action === "run" && event.phase === "dot_lint");
		expect(runDotLintEvent?.command).toContain("--strict-warnings");
		const dotLintPhase = result.phases.find((phase) => phase.phase === "dot_lint");
		expect(dotLintPhase?.command).toContain("--strict-warnings");
	});

	it("validates and lints workflow-source supervisor graphs through rendered semantics", async () => {
		const fixture = writeFactoryFixture({
			config: workflowSourceFactoryConfig(),
			graph: validGraph(),
			graphKind: "workflow_source",
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: repoRootForTests,
			commandRunner(request) {
				return successfulCommand(`${request.command} ${request.args.join(" ")}`);
			},
			phases: ["config_schema", "graph_validate", "dot_lint"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const graphValidatePhase = result.phases.find((phase) => phase.phase === "graph_validate");
		expect(graphValidatePhase?.details["supervisor_graph_source_kind"]).toBe("workflow_source");
		const dotLintPhase = result.phases.find((phase) => phase.phase === "dot_lint");
		expect(dotLintPhase?.details["supervisor_graph_source_kind"]).toBe("workflow_source");
		expect(String(dotLintPhase?.details["lint_target_path"] || "")).toContain("docs/contracts/workflow-ir/fixture/factory_supervisor_tick.dot");
	});

	it("propagates command failure metadata to first_failure", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandCwd: repoRootForTests,
			commandRunner(request) {
				if (request.args.some((arg) => String(arg).includes("lint-dot.mjs"))) {
					return {
						ok: false,
						command: `${request.command} ${request.args.join(" ")}`,
						stdout: "",
						stderr: "dot lint crashed",
						exitCode: 42,
						durationMs: 5,
						timedOut: false,
						errorMessage: "command exited with status 42",
					};
				}
				return successfulCommand(`${request.command} ${request.args.join(" ")}`);
			},
			phases: ["config_schema", "graph_validate", "dot_lint"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "dot_lint");
		expect(result.first_failure?.command).toContain("lint-dot.mjs");
		expect(result.first_failure?.exit_code).toBe(42);
	});

	it("accepts ops_contract probes that emit JSON after a startup preamble", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				if (request.args[0] === "factory" && request.args[1] === "tick-status") {
					return {
						...successfulCommand(asText),
						stdout: `[hatch] startup command=runs\n{"ok":true}`,
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "ops_contract"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});

	it("passes operational_e2e when emitted smoke run is visible through operator surfaces", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				const args = logicalCommandArgs(request);
				if (args[0] === "run") {
					const runId = String(args[args.indexOf("--run-id") + 1] || "");
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					const runDir = path.join(runsDir, runId);
					mkdirSync(runDir, { recursive: true });
					writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ runId, status: "completed" }, null, 2));
					return successfulCommand(asText);
				}
				if (args[0] === "factory" && args[1] === "status") {
					const runIds = readdirSync(String(request.env.HATCH_RUNS_DIR || ""));
					return {
						...successfulCommand(asText),
						stdout: JSON.stringify({
							active: runIds.map((id) => ({ run_id: id })),
						}),
					};
				}
				if (args[0] === "factory" && args[1] === "tick-status") {
					const runIds = readdirSync(String(request.env.HATCH_RUNS_DIR || ""));
					return {
						...successfulCommand(asText),
						stdout: JSON.stringify({
							ticks: runIds.map((id) => ({ id })),
						}),
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "scenario_root", "supervisor_tick_smoke", "operational_e2e"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		const phase = result.phases.find((entry) => entry.phase === "operational_e2e");
		expect(phase?.ok).toBe(true);
		expect(phase?.details["validated_factory_status"]).toBe(true);
		expect(phase?.details["observed_in_factory_tick_status"]).toBe(true);
	});

	it("uses conformance.smoke_graph for smoke phases when declared", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig({
				conformance: {
					entrypoint: "factories/fixture-factory/scripts/run-conformance.sh",
					fixtures: "factories/fixture-factory/conformance/fixtures",
					smoke_graph: "conformance/factory_supervisor_tick.dot",
					runs_dir: ".hatch/fixture-factory/runs",
				},
			}),
			graph: validGraph(),
		});
		writeFileSync(
			path.join(fixture.factoryRoot, "conformance", "factory_supervisor_tick.dot"),
			"digraph factory_supervisor_tick_conformance { start [shape=Mdiamond]; done [shape=Msquare recovery_sink_type=\"terminal\"]; start -> done }\n",
		);
		const seenRunCommands: string[] = [];

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				const args = logicalCommandArgs(request);
				if (args[0] === "run") {
					seenRunCommands.push(asText);
					const runId = String(args[args.indexOf("--run-id") + 1] || "");
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					const runDir = path.join(runsDir, runId);
					mkdirSync(runDir, { recursive: true });
					writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ runId, status: "completed" }, null, 2));
					return successfulCommand(asText);
				}
				if (args[0] === "factory" && args[1] === "status") {
					const runIds = readdirSync(String(request.env.HATCH_RUNS_DIR || ""));
					return {
						...successfulCommand(asText),
						stdout: JSON.stringify({ active: runIds.map((id) => ({ run_id: id })) }),
					};
				}
				if (args[0] === "factory" && args[1] === "tick-status") {
					const runIds = readdirSync(String(request.env.HATCH_RUNS_DIR || ""));
					return {
						...successfulCommand(asText),
						stdout: JSON.stringify({ ticks: runIds.map((id) => ({ id })) }),
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "scenario_root", "supervisor_tick_smoke", "operational_e2e"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		expect(seenRunCommands.every((command) => command.includes("conformance/factory_supervisor_tick.dot"))).toBe(true);
		expect(seenRunCommands.some((command) => command.includes("graphs/factory_supervisor_tick.dot --run-id"))).toBe(false);
	});

	it("fails operational_e2e when emitted smoke run is not visible through tick status", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				const args = logicalCommandArgs(request);
				if (args[0] === "run") {
					const runId = String(args[args.indexOf("--run-id") + 1] || "");
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					const runDir = path.join(runsDir, runId);
					mkdirSync(runDir, { recursive: true });
					writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ runId, status: "completed" }, null, 2));
					return successfulCommand(asText);
				}
				if (args[0] === "factory" && args[1] === "status") {
					const runIds = readdirSync(String(request.env.HATCH_RUNS_DIR || ""));
					return {
						...successfulCommand(asText),
						stdout: JSON.stringify({
							active: runIds.map((id) => ({ run_id: id })),
						}),
					};
				}
				if (args[0] === "factory" && args[1] === "tick-status") {
					return {
						...successfulCommand(asText),
						stdout: JSON.stringify({
							ticks: [],
						}),
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "scenario_root", "supervisor_tick_smoke", "operational_e2e"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "operational_e2e");
		expect(result.first_failure?.error).toContain("could not validate factory status or observe the emitted supervisor run through tick status");
	});

	it("uses target_repo for ops_contract probes", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig({
				target_repo: "example-org/fixture-factory-home",
			}),
			graph: validGraph(),
		});
		const commands: string[] = [];

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				commands.push(asText);
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "ops_contract"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		expect(commands.some((command) => command.includes("--repo example-org/fixture-factory-home"))).toBe(true);
		expect(commands.some((command) => command.includes("--repo --control-plane-repo"))).toBe(false);
	});

	it("sets deterministic factory context env before ops_contract probes", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});
		const seenProbeEnv = new Map<string, NodeJS.ProcessEnv>();

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				if (request.args[0] === "factory" || request.args[0] === "runs") {
					seenProbeEnv.set(request.args.join(" "), request.env);
				}
				return successfulCommand(`${request.command} ${request.args.join(" ")}`);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "ops_contract"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		expect(result.ok).toBe(true);
		for (const env of seenProbeEnv.values()) {
			expect(env.HATCH_FACTORY_ID).toBe("fixture-factory");
			expect(env.HATCH_RUNS_DIR).toContain(".hatch/fixture-factory/runs");
			expect(env.HATCH_FACTORY_ROOT).toBe(fixture.factoryRoot);
			expect(env.HATCH_FACTORY_CONFIG_PATH).toBe(path.join(fixture.factoryRoot, "factory.config.json"));
			expect(env.HATCH_SCENARIOS_ROOT).toBe(path.join(fixture.factoryRoot, "scenarios", "fixture-factory"));
		}
	});

	it("fails ops_contract when probe output is not JSON", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				if (request.args.includes("status") || request.args.includes("tick-status")) {
					return {
						...successfulCommand(asText),
						stdout: "NOT_JSON",
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "ops_contract"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "ops_contract");
		expect(result.first_failure?.error).toContain("ops contract probe output is not valid JSON");
	});

	it("fails supervisor_tick_smoke when command exits non-zero", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				if (logicalCommandArgs(request)[0] === "run") {
					return {
						ok: false,
						command: asText,
						stdout: "",
						stderr: "smoke tick failed",
						exitCode: 9,
						durationMs: 10,
						timedOut: false,
						errorMessage: "command exited with status 9",
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "recovery_ownership", "benchmark_telemetry", "run_dir_isolation", "supervisor_tick_smoke"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "supervisor_tick_smoke");
		expect(result.first_failure?.command).toContain("hatch run");
		expect(result.first_failure?.exit_code).toBe(9);
	});

	it("fails supervisor_tick_smoke when run artifacts are missing", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				return successfulCommand(`${request.command} ${request.args.join(" ")}`);
			},
			phases: ["config_schema", "graph_validate", "recovery_ownership", "benchmark_telemetry", "run_dir_isolation", "supervisor_tick_smoke"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "supervisor_tick_smoke");
		expect(result.first_failure?.error).toContain("did not emit expected run artifacts");
	});

	it("fails ops_contract when a probe exits non-zero", async () => {
		const fixture = writeFactoryFixture({
			config: baseFactoryConfig(),
			graph: validGraph(),
		});

		const result = await runFactoryConformanceHarness({
			factoryRoot: fixture.factoryRoot,
			repoRoot: fixture.repoRoot,
			commandRunner(request) {
				const asText = `${request.command} ${request.args.join(" ")}`;
				if (request.args.includes("tick-status")) {
					return {
						ok: false,
						command: asText,
						stdout: "",
						stderr: "tick-status failed",
						exitCode: 17,
						durationMs: 6,
						timedOut: false,
						errorMessage: "command exited with status 17",
					};
				}
				return successfulCommand(asText);
			},
			phases: ["config_schema", "graph_validate", "run_dir_isolation", "ops_contract"],
		});

		rmSync(fixture.repoRoot, { recursive: true, force: true });

		assertFailedPhase(result, "ops_contract");
		expect(result.first_failure?.command).toContain("tick-status");
		expect(result.first_failure?.exit_code).toBe(17);
	});
});
