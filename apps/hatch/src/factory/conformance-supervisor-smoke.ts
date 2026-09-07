import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runScenarioRootPhase } from "./conformance-runtime-inputs.js";
import {
	HarnessFailure,
	formatCommand,
	isPlainObject,
	parseJson,
	resolveCommandInvocation,
	resolveSupervisorGraphPath,
	type FactoryConformanceCommandRunner,
} from "./conformance-support.js";
import type { FactoryConfigDocument } from "./config-schema.js";

interface SupervisorSmokeRun {
	runId: string;
	runsDir: string;
	runDir: string;
	statePath: string;
	command: string;
	cleanup: () => void;
}

export function resolveConformanceSmokeGraphPath(args: {
	config: FactoryConfigDocument;
	factoryConfigPath: string;
	supervisorGraphPath: string;
	repoRoot: string;
	factoryRoot: string;
}): string {
	const configuredSmokeGraph = String(args.config.conformance?.smoke_graph || "").trim();
	if (!configuredSmokeGraph) {
		return args.supervisorGraphPath;
	}

	return resolveSupervisorGraphPath({
		supervisorTickPath: configuredSmokeGraph,
		repoRoot: args.repoRoot,
		factoryRoot: args.factoryRoot,
		factoryConfigPath: args.factoryConfigPath,
	});
}

export function runSupervisorTickSmokePhase(args: {
	config: FactoryConfigDocument;
	factoryConfigPath: string;
	supervisorGraphPath: string;
	repoRoot: string;
	factoryRoot: string;
	commandCwd: string;
	timeoutMs: number;
	runCommand: FactoryConformanceCommandRunner;
}): { details: Record<string, unknown>; command: string } {
	const smokeRun = runIsolatedSupervisorTick(args);
	try {
		return {
			details: {
				run_id: smokeRun.runId,
				runs_dir: smokeRun.runsDir,
				run_dir: smokeRun.runDir,
				state_path: smokeRun.statePath,
			},
			command: smokeRun.command,
		};
	} finally {
		smokeRun.cleanup();
	}
}

export function runOperationalE2EPhase(args: {
	config: FactoryConfigDocument;
	factoryConfigPath: string;
	supervisorGraphPath: string;
	repoRoot: string;
	factoryRoot: string;
	commandCwd: string;
	timeoutMs: number;
	runCommand: FactoryConformanceCommandRunner;
}): { details: Record<string, unknown>; command: string } {
	const hatchOpsBin = resolveCommandInvocation("hatch-ops", args.commandCwd);
	const repoFlagValue = String(args.config.target_repo || "").trim();
	const scenariosRootDetails = runScenarioRootPhase(args.config, args.repoRoot, args.factoryRoot).details;
	const resolvedScenariosRoot = String(scenariosRootDetails["resolved_path"] || "");
	const destinationsJson = args.config.destinations ? JSON.stringify(args.config.destinations) : "";
	const smokeRun = runIsolatedSupervisorTick(args);

	const probeEnv: NodeJS.ProcessEnv = {
		...process.env,
		HATCH_FACTORY_GITHUB_TOKEN: process.env.HATCH_FACTORY_GITHUB_TOKEN || "conformance-token",
		HATCH_FACTORY_CONFIG_PATH: args.factoryConfigPath,
		HATCH_FACTORY_ROOT: args.factoryRoot,
		HATCH_FACTORY_ID: args.config.factory_id,
		HATCH_TARGET_REPO: repoFlagValue,
		HATCH_GH_REPO: repoFlagValue,
		HATCH_CONTROL_PLANE_REPO: args.config.control_plane_repo,
		HATCH_KIND_ID: String(args.config.kind_id || ""),
		HATCH_INSTANCE_ID: String(args.config.instance_id || ""),
		HATCH_DESTINATIONS_JSON: destinationsJson,
		HATCH_RUNS_DIR: smokeRun.runsDir,
		HATCH_SCENARIOS_ROOT: resolvedScenariosRoot,
		HATCH_CANONICAL_CHECKOUT_PATH: "",
		FACTORY_CONTEXT_REPO_PATH: "",
	};
	const probes = [
		{
			name: "factory_status",
			args: [
				"factory",
				"status",
				"--factory-root",
				args.factoryRoot,
				"--factory-id",
				args.config.factory_id,
				...(repoFlagValue ? ["--repo", repoFlagValue] : []),
				"--control-plane-repo",
				args.config.control_plane_repo,
				"--json",
			],
		},
		{
			name: "factory_tick_status",
			args: [
				"factory",
				"tick-status",
				"--factory-root",
				args.factoryRoot,
				"--factory-id",
				args.config.factory_id,
				...(repoFlagValue ? ["--repo", repoFlagValue] : []),
				"--control-plane-repo",
				args.config.control_plane_repo,
				"--json",
			],
		},
	];

	try {
		const probeResults: Array<Record<string, unknown>> = [];
		let sawRunInStatus = false;
		let sawRunInTickStatus = false;
		let validatedFactoryStatus = false;
		for (const probe of probes) {
			const displayCommand = formatCommand(hatchOpsBin.displayCommand, probe.args);
			const command = args.runCommand({
				command: hatchOpsBin.command,
				args: [...hatchOpsBin.argsPrefix, ...probe.args],
				cwd: args.commandCwd,
				env: probeEnv,
				timeoutMs: args.timeoutMs,
			});
			if (!command.ok) {
				throw new HarnessFailure(`operational e2e probe failed (${probe.name}): ${command.errorMessage || "non-zero exit"}`, {
					details: {
						probe: probe.name,
						run_id: smokeRun.runId,
						stdout: command.stdout,
						stderr: command.stderr,
						timed_out: command.timedOut,
					},
					command: displayCommand,
					exitCode: command.exitCode,
				});
			}

			const payload = parseJson(command.stdout);
			if (!payload.ok || !isPlainObject(payload.value)) {
				throw new HarnessFailure(`operational e2e probe output is not valid JSON (${probe.name})`, {
					details: {
						probe: probe.name,
						run_id: smokeRun.runId,
						stdout: command.stdout,
						stderr: command.stderr,
					},
					command: displayCommand,
				});
			}

			if (probe.name === "factory_status") {
				validatedFactoryStatus = true;
				const activeRuns = Array.isArray(payload.value["active"]) ? payload.value["active"] : [];
				sawRunInStatus = activeRuns.some((entry) => isPlainObject(entry) && String(entry["run_id"] || entry["id"] || "") === smokeRun.runId);
			}
			if (probe.name === "factory_tick_status") {
				const ticks = Array.isArray(payload.value["ticks"]) ? payload.value["ticks"] : [];
				sawRunInTickStatus = ticks.some((entry) => isPlainObject(entry) && String(entry["id"] || "") === smokeRun.runId);
			}

			probeResults.push({
				name: probe.name,
				command: displayCommand,
				exit_code: command.exitCode,
			});
		}

		if (!validatedFactoryStatus || !sawRunInTickStatus) {
			throw new HarnessFailure("operational e2e could not validate factory status or observe the emitted supervisor run through tick status", {
				details: {
					run_id: smokeRun.runId,
					validated_factory_status: validatedFactoryStatus,
					observed_in_factory_status: sawRunInStatus,
					observed_in_factory_tick_status: sawRunInTickStatus,
					runs_dir: smokeRun.runsDir,
				},
				command: probeResults.map((entry) => String(entry["command"] || "")).join(" && "),
			});
		}

		return {
			details: {
				run_id: smokeRun.runId,
				runs_dir: smokeRun.runsDir,
				probe_count: probeResults.length,
				probes: probeResults,
				validated_factory_status: validatedFactoryStatus,
				observed_in_factory_status: sawRunInStatus,
				observed_in_factory_tick_status: sawRunInTickStatus,
			},
			command: probeResults.map((entry) => String(entry["command"] || "")).join(" && "),
		};
	} finally {
		smokeRun.cleanup();
	}
}

function runIsolatedSupervisorTick(args: {
	config: FactoryConfigDocument;
	factoryConfigPath: string;
	supervisorGraphPath: string;
	repoRoot: string;
	factoryRoot: string;
	commandCwd: string;
	timeoutMs: number;
	runCommand: FactoryConformanceCommandRunner;
}): SupervisorSmokeRun {
	const supervisorGraphPath = resolveConformanceSmokeGraphPath(args);
	const hatchInvocation = resolveCommandInvocation("hatch", args.commandCwd);
	const runsDir = mkdtempSync(path.join(tmpdir(), `factory-conformance-${args.config.factory_id}-`));
	const runId = `conformance-smoke-${Date.now()}`;
	const contextJson = JSON.stringify({
		repo: args.repoRoot,
		gh_repo: args.config.target_repo,
		control_plane: args.config.control_plane_repo,
		factory_id: args.config.factory_id,
	});

	const env: NodeJS.ProcessEnv = {
		...process.env,
		HATCH_RUNS_DIR: runsDir,
		HATCH_FACTORY_ID: args.config.factory_id,
		HATCH_FACTORY_ROOT: args.factoryRoot,
		HATCH_FACTORY_CONFIG_PATH: args.factoryConfigPath,
		HATCH_INTENT_PATHS: "",
		HATCH_CANONICAL_CHECKOUT_PATH: "",
		FACTORY_CONTEXT_REPO_PATH: "",
	};
	const smokeArgs = ["run", supervisorGraphPath, "--checkpoint", "--run-id", runId, "--context", contextJson];
	const actualArgs = [...hatchInvocation.argsPrefix, ...smokeArgs];
	const displayCommand = formatCommand(hatchInvocation.displayCommand, smokeArgs);
	const command = args.runCommand({
		command: hatchInvocation.command,
		args: actualArgs,
		cwd: args.repoRoot,
		env,
		timeoutMs: args.timeoutMs,
	});
	if (!command.ok) {
		throw new HarnessFailure(`supervisor smoke tick failed: ${command.errorMessage || command.stderr || "non-zero exit"}`, {
			details: {
				run_id: runId,
				runs_dir: runsDir,
				stdout: command.stdout,
				stderr: command.stderr,
				timed_out: command.timedOut,
			},
			command: displayCommand,
			exitCode: command.exitCode,
		});
	}

	const runDir = path.join(runsDir, runId);
	const statePath = path.join(runDir, "state.json");
	if (!existsSync(runDir) || !existsSync(statePath)) {
		throw new HarnessFailure("supervisor smoke tick did not emit expected run artifacts", {
			details: {
				run_id: runId,
				runs_dir: runsDir,
				run_dir: runDir,
				state_path: statePath,
			},
			command: displayCommand,
		});
	}

	return {
		runId,
		runsDir,
		runDir,
		statePath,
		command: displayCommand,
		cleanup() {
			rmSync(runsDir, { recursive: true, force: true });
		},
	};
}
