import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	resolveConformanceSmokeGraphPath,
	runOperationalE2EPhase,
	runSupervisorTickSmokePhase,
} from "./conformance-supervisor-smoke.js";
import type { FactoryConfigDocument } from "./config-schema.js";

function baseConfig(factoryRoot: string): FactoryConfigDocument {
	return {
		schema: "hatch.factory.config.v1",
		factory_id: "fixture-factory",
		target_repo: "example-org/fixture-factory",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: { graph: "graphs/factory_supervisor_tick.dot" },
		skills: { supervisor: "factories/fixture-factory/skills/supervisor/current.md" },
		scenarios: { root: "factories/fixture-factory/scenarios/fixture-factory" },
		pipeline: { supervisor_tick: "graphs/factory_supervisor_tick.dot" },
		conformance: {
			entrypoint: "factories/fixture-factory/scripts/run-conformance.sh",
			fixtures: "factories/fixture-factory/conformance/fixtures",
			smoke_graph: "conformance/factory_supervisor_tick.dot",
			runs_dir: ".hatch/fixture-factory/runs",
		},
		runs_dir: ".hatch/fixture-factory/runs",
		trust: {
			domain: "fixture-factory.local",
			roles: ["fixture-factory.local.tool"],
		},
		policyPack: { version: "v1", overrides: {} },
	};
}

function createFixture(): {
	repoRoot: string;
	factoryRoot: string;
	config: FactoryConfigDocument;
	factoryConfigPath: string;
	supervisorGraphPath: string;
	smokeGraphPath: string;
} {
	const repoRoot = mkdtempSync(path.join(tmpdir(), "conformance-smoke-"));
	const factoryRoot = path.join(repoRoot, "factories", "fixture-factory");
	mkdirSync(path.join(factoryRoot, "graphs"), { recursive: true });
	mkdirSync(path.join(factoryRoot, "conformance"), { recursive: true });
	mkdirSync(path.join(factoryRoot, "scenarios", "fixture-factory"), { recursive: true });
	const supervisorGraphPath = path.join(factoryRoot, "graphs", "factory_supervisor_tick.dot");
	const smokeGraphPath = path.join(factoryRoot, "conformance", "factory_supervisor_tick.dot");
	writeFileSync(supervisorGraphPath, "digraph factory_supervisor_tick { start -> done }\n");
	writeFileSync(smokeGraphPath, "digraph factory_supervisor_tick { start -> done }\n");
	writeFileSync(path.join(factoryRoot, "scenarios", "fixture-factory", "README.md"), "# scenarios\n");
	const config = baseConfig(factoryRoot);
	const factoryConfigPath = path.join(factoryRoot, "factory.config.json");
	writeFileSync(factoryConfigPath, `${JSON.stringify(config, null, 2)}\n`);
	return { repoRoot, factoryRoot, config, factoryConfigPath, supervisorGraphPath, smokeGraphPath };
}

describe("conformance supervisor smoke helpers", () => {
	it("resolves configured conformance smoke graphs", () => {
		const fixture = createFixture();
		expect(resolveConformanceSmokeGraphPath({
			config: fixture.config,
			factoryConfigPath: fixture.factoryConfigPath,
			supervisorGraphPath: fixture.supervisorGraphPath,
			repoRoot: fixture.repoRoot,
			factoryRoot: fixture.factoryRoot,
		})).toBe(fixture.smokeGraphPath);
	});

	it("runs a supervisor smoke phase and records the emitted run", () => {
		const fixture = createFixture();
		const requests: Array<{ env: NodeJS.ProcessEnv; args: string[] }> = [];
		const result = runSupervisorTickSmokePhase({
			config: fixture.config,
			factoryConfigPath: fixture.factoryConfigPath,
			supervisorGraphPath: fixture.supervisorGraphPath,
			repoRoot: fixture.repoRoot,
			factoryRoot: fixture.factoryRoot,
			commandCwd: fixture.repoRoot,
			timeoutMs: 30_000,
			runCommand(request) {
				requests.push({ env: request.env, args: request.args });
				const runId = request.args[request.args.indexOf("--run-id") + 1] || "conformance-smoke-test";
				const runsDir = String(request.env.HATCH_RUNS_DIR || "");
				const runDir = path.join(runsDir, runId);
				mkdirSync(runDir, { recursive: true });
				writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ id: runId }));
				return {
					ok: true,
					command: `${request.command} ${request.args.join(" ")}`,
					stdout: "",
					stderr: "",
					exitCode: 0,
					durationMs: 1,
					timedOut: false,
					errorMessage: "",
				};
			},
		});

		expect(String(result.details.run_id || "")).toContain("conformance-smoke-");
		expect(String(result.details.state_path || "")).toContain("/state.json");
		expect(requests).toHaveLength(1);
		expect(requests[0]?.env.HATCH_FACTORY_ROOT).toBe(fixture.factoryRoot);
		expect(requests[0]?.env.HATCH_FACTORY_CONFIG_PATH).toBe(fixture.factoryConfigPath);
	});

	it("runs operational e2e probes against the emitted supervisor run", () => {
		const fixture = createFixture();
		const result = runOperationalE2EPhase({
			config: fixture.config,
			factoryConfigPath: fixture.factoryConfigPath,
			supervisorGraphPath: fixture.supervisorGraphPath,
			repoRoot: fixture.repoRoot,
			factoryRoot: fixture.factoryRoot,
			commandCwd: fixture.repoRoot,
			timeoutMs: 30_000,
			runCommand(request) {
				const logicalArgs = request.command === process.execPath ? request.args.slice(1) : request.args;
				if (logicalArgs[0] === "run") {
					const runId = logicalArgs[logicalArgs.indexOf("--run-id") + 1] || "conformance-smoke-test";
					const runsDir = String(request.env.HATCH_RUNS_DIR || "");
					const runDir = path.join(runsDir, runId);
					mkdirSync(runDir, { recursive: true });
					writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ id: runId }));
					return {
						ok: true,
						command: `${request.command} ${request.args.join(" ")}`,
						stdout: "",
						stderr: "",
						exitCode: 0,
						durationMs: 1,
						timedOut: false,
						errorMessage: "",
					};
				}

				const runsDir = String(request.env.HATCH_RUNS_DIR || "");
				const [runId] = readdirSync(runsDir);
				const [subcommand, nested] = logicalArgs;
				let payload: Record<string, unknown>;
				if (subcommand === "factory" && nested === "status") {
					payload = { active: [{ run_id: runId }] };
				} else if (subcommand === "factory" && nested === "tick-status") {
					payload = { ticks: [{ id: runId }] };
				} else {
					payload = {};
				}

				return {
					ok: true,
					command: `${request.command} ${request.args.join(" ")}`,
					stdout: JSON.stringify(payload),
					stderr: "",
					exitCode: 0,
					durationMs: 1,
					timedOut: false,
					errorMessage: "",
				};
			},
		});

		expect(result.details.validated_factory_status).toBe(true);
		expect(result.details.observed_in_factory_tick_status).toBe(true);
		expect(result.details.probe_count).toBe(2);
	});
});
