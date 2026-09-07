import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
	BenchmarkTelemetryPhaseError,
	evaluateBenchmarkTelemetryPhase,
	type BenchmarkTelemetryPhaseEvaluation,
} from "./benchmark-telemetry-phase.js";
import {
	formatPolicyPackIssue,
	getFactoryIsolationConfig,
	loadPolicyPackDocuments,
	parseFactoryConfigDocument,
	resolveFactoryRuntimePaths,
	validateFactoryConfigDocument,
	validatePolicyPackContract,
	type FactoryConfigDocument,
	type FactoryRuntimePaths,
} from "./config-schema.js";
import {
	formatIntentStackCommandHint,
	runIntentStackPhase,
	runScenarioRootPhase,
	runSkillLoadingPhase,
} from "./conformance-runtime-inputs.js";
import {
	HarnessFailure,
	asHarnessFailure,
	defaultCommandRunner,
	formatCommand,
	isPlainObject,
	isPathWithin,
	parseJson,
	resolveCommandInvocation,
	resolveSupervisorGraphPath,
} from "./conformance-support.js";
import {
	runOperationalE2EPhase,
	resolveConformanceSmokeGraphPath,
	runSupervisorTickSmokePhase,
} from "./conformance-supervisor-smoke.js";
import { validatePolicyPackMetadata } from "./policy-pack.js";
import { findRepoRoot } from "../intent/loader.js";
import { nodeHandlerType, outgoingEdges } from "../pipeline/graph.js";
import { loadGraphSource } from "../pipeline/graph-source.js";
import { parse } from "../pipeline/parse.js";
import {
	extractGraphRecoveryMetadata,
	isApprovedRecoverySink,
	isSupervisorOwnedRecovery,
} from "../pipeline/recovery-contract.js";
import { formatValidationError, hasValidationErrors, validate } from "../pipeline/validate.js";
import type { Graph } from "../pipeline/graph.js";
export const FACTORY_CONFORMANCE_PHASES = [
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
] as const;

export type FactoryConformancePhase = (typeof FACTORY_CONFORMANCE_PHASES)[number];
function describeConformancePhase(phase: FactoryConformancePhase): string {
	switch (phase) {
		case "config_schema":
			return "Config schema";
		case "intent_stack":
			return "Intent stack";
		case "policy_pack_conformance":
			return "Policy pack conformance";
		case "graph_validate":
			return "Graph validate";
		case "dot_lint":
			return "DOT lint";
		case "recovery_ownership":
			return "Recovery ownership";
		case "run_dir_isolation":
			return "Run dir isolation";
		case "skill_loading":
			return "Skill loading";
		case "scenario_root":
			return "Scenario root";
		case "benchmark_telemetry":
			return "Benchmark telemetry";
		case "supervisor_tick_smoke":
			return "Supervisor tick smoke";
		case "operational_e2e":
			return "Operational E2E";
		case "ops_contract":
			return "Ops contract";
		default:
			return phase;
	}
}
export interface FactoryConformancePhaseResult {
	phase: FactoryConformancePhase;
	ok: boolean;
	duration_ms: number;
	details: Record<string, unknown>;
	error?: string;
	command?: string;
	exit_code?: number;
}
export interface FactoryConformanceFirstFailure {
	phase: FactoryConformancePhase;
	error: string;
	command?: string;
	exit_code?: number;
}
export interface FactoryConformanceHarnessResult {
	ok: boolean;
	factory_root: string;
	repo_root: string;
	phases: FactoryConformancePhaseResult[];
	failed_phase: FactoryConformancePhase | "";
	first_failure: FactoryConformanceFirstFailure | null;
}
export interface FactoryConformancePhaseEvent {
	phase: FactoryConformancePhase;
	phase_label?: string;
	action: "run" | "result";
	command?: string;
	ok?: boolean;
	duration_ms?: number;
	error?: string;
	exit_code?: number;
}
export interface FactoryConformanceCommandRequest {
	command: string;
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs: number;
}
export interface FactoryConformanceCommandResult {
	ok: boolean;
	command: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	durationMs: number;
	timedOut: boolean;
	errorMessage: string;
}
export type FactoryConformanceCommandRunner = (request: FactoryConformanceCommandRequest) => FactoryConformanceCommandResult;
export interface RunFactoryConformanceHarnessOptions {
	factoryRoot: string;
	repoRoot?: string;
	runsDir?: string;
	phases?: FactoryConformancePhase[];
	dotLintStrictWarnings?: boolean;
	commandTimeoutMs?: number;
	smokeTimeoutMs?: number;
	commandCwd?: string;
	lintScriptPath?: string;
	skipMissingLintScript?: boolean;
	onPhaseEvent?: (event: FactoryConformancePhaseEvent) => void;
	commandRunner?: FactoryConformanceCommandRunner;
}
interface HarnessState {
	factoryConfig: FactoryConfigDocument | null;
	factoryConfigPath: string;
	supervisorGraphPath: string;
	supervisorGraph: Graph | null;
	runtimePaths: FactoryRuntimePaths | null;
}
export async function runFactoryConformanceHarness(
	options: RunFactoryConformanceHarnessOptions,
): Promise<FactoryConformanceHarnessResult> {
	const factoryRoot = path.resolve(String(options.factoryRoot || ""));
	if (!factoryRoot) {
		throw new Error("factoryRoot is required");
	}

	const repoRoot = path.resolve(options.repoRoot || findRepoRoot(factoryRoot));
	const commandCwd = path.resolve(options.commandCwd || process.cwd());
	const commandTimeoutMs = Math.max(1_000, Number(options.commandTimeoutMs || 90_000));
	const smokeTimeoutMs = Math.max(1_000, Number(options.smokeTimeoutMs || 120_000));
	const phases = resolveRequestedPhases(options.phases);
	const runCommand = options.commandRunner ?? defaultCommandRunner;

	const state: HarnessState = {
		factoryConfig: null,
		factoryConfigPath: path.join(factoryRoot, "factory.config.json"),
		supervisorGraphPath: "",
		supervisorGraph: null,
		runtimePaths: null,
	};

	const phaseResults: FactoryConformancePhaseResult[] = [];

	for (const phase of phases) {
		const runCommandHint = phaseRunCommandHint({
			phase,
			state,
			commandCwd,
			repoRoot,
			factoryRoot,
			runsDirOverride: options.runsDir,
			lintScriptPath: options.lintScriptPath,
			dotLintStrictWarnings: options.dotLintStrictWarnings,
		});
		options.onPhaseEvent?.({
			phase,
			phase_label: describeConformancePhase(phase),
			action: "run",
			...(runCommandHint ? { command: runCommandHint } : {}),
		});
		const phaseStart = Date.now();
		try {
			const phaseOutput = await runPhase({
				phase,
				factoryRoot,
				repoRoot,
				state,
				runsDirOverride: options.runsDir,
				commandCwd,
				commandTimeoutMs,
				smokeTimeoutMs,
				runCommand,
				lintScriptPath: options.lintScriptPath,
				skipMissingLintScript: options.skipMissingLintScript,
				dotLintStrictWarnings: options.dotLintStrictWarnings,
			});

			const phaseResult: FactoryConformancePhaseResult = {
				phase,
				ok: true,
				duration_ms: Date.now() - phaseStart,
				details: phaseOutput.details,
				...(phaseOutput.command ? { command: phaseOutput.command } : {}),
			};
			phaseResults.push(phaseResult);
			options.onPhaseEvent?.({
				phase,
				phase_label: describeConformancePhase(phase),
				action: "result",
				ok: true,
				duration_ms: phaseResult.duration_ms,
				...(phaseResult.command ? { command: phaseResult.command } : {}),
			});
		} catch (error) {
			const failure = asHarnessFailure(error);
			const phaseResult: FactoryConformancePhaseResult = {
				phase,
				ok: false,
				duration_ms: Date.now() - phaseStart,
				details: failure.details,
				error: failure.message,
				...(failure.command ? { command: failure.command } : {}),
				...(failure.exitCode ? { exit_code: failure.exitCode } : {}),
			};
			phaseResults.push(phaseResult);
			options.onPhaseEvent?.({
				phase,
				phase_label: describeConformancePhase(phase),
				action: "result",
				ok: false,
				duration_ms: phaseResult.duration_ms,
				error: phaseResult.error,
				...(phaseResult.command ? { command: phaseResult.command } : {}),
				...(phaseResult.exit_code ? { exit_code: phaseResult.exit_code } : {}),
			});

			return {
				ok: false,
				factory_root: factoryRoot,
				repo_root: repoRoot,
				phases: phaseResults,
				failed_phase: phase,
				first_failure: {
					phase,
					error: failure.message,
					...(failure.command ? { command: failure.command } : {}),
					...(failure.exitCode ? { exit_code: failure.exitCode } : {}),
				},
			};
		}
	}

	return {
		ok: true,
		factory_root: factoryRoot,
		repo_root: repoRoot,
		phases: phaseResults,
		failed_phase: "",
		first_failure: null,
	};
}
async function runPhase(args: {
	phase: FactoryConformancePhase;
	factoryRoot: string;
	repoRoot: string;
	state: HarnessState;
	runsDirOverride?: string;
	commandCwd: string;
	commandTimeoutMs: number;
	smokeTimeoutMs: number;
	runCommand: FactoryConformanceCommandRunner;
	lintScriptPath?: string;
	skipMissingLintScript?: boolean;
	dotLintStrictWarnings?: boolean;
}): Promise<{ details: Record<string, unknown>; command?: string }> {
	switch (args.phase) {
		case "config_schema":
			return runConfigSchemaPhase(args.state);
		case "intent_stack":
			return runIntentStackPhase({
				factoryRoot: args.factoryRoot,
				commandCwd: args.commandCwd,
				timeoutMs: args.commandTimeoutMs,
				runCommand: args.runCommand,
			});
		case "policy_pack_conformance":
			return runPolicyPackConformancePhase({
				state: args.state,
				factoryRoot: args.factoryRoot,
			});
		case "graph_validate":
			return runGraphValidatePhase(args.state, args.repoRoot, args.factoryRoot);
		case "dot_lint":
			return runDotLintPhase(
				args.state,
				args.repoRoot,
				args.commandCwd,
				args.commandTimeoutMs,
				args.runCommand,
				args.lintScriptPath,
				args.skipMissingLintScript,
				args.dotLintStrictWarnings,
			);
		case "recovery_ownership":
			return runRecoveryOwnershipPhase(args.state);
		case "run_dir_isolation":
			return runRunDirIsolationPhase(args.state, args.repoRoot, args.factoryRoot, args.runsDirOverride);
		case "skill_loading":
			return runSkillLoadingPhase(requireFactoryConfig(args.state), args.repoRoot, args.factoryRoot);
		case "scenario_root":
			return runScenarioRootPhase(requireFactoryConfig(args.state), args.repoRoot, args.factoryRoot);
		case "benchmark_telemetry":
			return runBenchmarkTelemetryPhase({
				state: args.state,
				factoryRoot: args.factoryRoot,
				repoRoot: args.repoRoot,
			});
		case "supervisor_tick_smoke":
			return runSupervisorTickSmokePhase({
				config: requireFactoryConfig(args.state),
				factoryConfigPath: args.state.factoryConfigPath,
				supervisorGraphPath: requireSupervisorGraphPath(args.state),
				repoRoot: args.repoRoot,
				factoryRoot: args.factoryRoot,
				commandCwd: args.commandCwd,
				timeoutMs: args.smokeTimeoutMs,
				runCommand: args.runCommand,
			});
		case "operational_e2e":
			return runOperationalE2EPhase({
				config: requireFactoryConfig(args.state),
				factoryConfigPath: args.state.factoryConfigPath,
				supervisorGraphPath: requireSupervisorGraphPath(args.state),
				repoRoot: args.repoRoot,
				factoryRoot: args.factoryRoot,
				commandCwd: args.commandCwd,
				timeoutMs: args.smokeTimeoutMs,
				runCommand: args.runCommand,
			});
		case "ops_contract":
			return runOpsContractPhase({
				state: args.state,
				repoRoot: args.repoRoot,
				factoryRoot: args.factoryRoot,
				commandCwd: args.commandCwd,
				timeoutMs: args.commandTimeoutMs,
				runCommand: args.runCommand,
			});
		default:
			throw new HarnessFailure(`unsupported phase: ${String(args.phase)}`);
	}
}
function runConfigSchemaPhase(state: HarnessState): { details: Record<string, unknown> } {
	if (!existsSync(state.factoryConfigPath)) {
		throw new HarnessFailure(`factory config not found: ${state.factoryConfigPath}`, {
			details: { factory_config_path: state.factoryConfigPath },
		});
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(state.factoryConfigPath, "utf8"));
	} catch (error) {
		throw new HarnessFailure(`factory config is not valid JSON (${state.factoryConfigPath})`, {
			details: {
				factory_config_path: state.factoryConfigPath,
				error: error instanceof Error ? error.message : String(error),
			},
		});
	}

	const issues = validateFactoryConfigDocument(parsed);
	if (issues.length > 0) {
		throw new HarnessFailure(`factory config schema validation failed: ${issues[0]?.path || "(root)"}: ${issues[0]?.message || "invalid"}`, {
			details: {
				factory_config_path: state.factoryConfigPath,
				issues,
			},
		});
	}

	state.factoryConfig = parseFactoryConfigDocument(parsed);
	return {
		details: {
			factory_config_path: state.factoryConfigPath,
			factory_id: state.factoryConfig.factory_id,
			target_repo: state.factoryConfig.target_repo,
		},
	};
}
function runPolicyPackConformancePhase(args: {
	state: HarnessState;
	factoryRoot: string;
}): { details: Record<string, unknown> } {
	// Keep deployed factory packs aligned with the canonical template contract suites.
	const config = requireFactoryConfig(args.state);
	const policyPackVersion = String(config.policyPack?.version || "").trim();
	if (!policyPackVersion) {
		return {
			details: {
				skipped: true,
				reason: "no_policy_pack_config",
			},
		};
	}

	const policyPackBaseDir = path.join(args.factoryRoot, "policy-pack");
	if (!existsSync(policyPackBaseDir)) {
		return {
			details: {
				skipped: true,
				reason: "no_policy_pack_dir",
			},
		};
	}

	const policyPackDir = path.join(policyPackBaseDir, policyPackVersion);
	if (!existsSync(policyPackDir)) {
		throw new HarnessFailure(`policy pack directory not found: ${policyPackDir}`, {
			details: {
				policy_pack_dir: policyPackDir,
				policy_pack_version: policyPackVersion,
			},
		});
	}

	const docs = (() => {
		try {
			return loadPolicyPackDocuments(policyPackDir);
		} catch (error) {
			throw new HarnessFailure(`policy pack load failed: ${error instanceof Error ? error.message : String(error)}`, {
				details: {
					policy_pack_dir: policyPackDir,
					policy_pack_version: policyPackVersion,
				},
			});
		}
	})();
	const metadataIssues = validatePolicyPackMetadata(docs.metadata).map((issue) => formatPolicyPackIssue(issue));
	if (metadataIssues.length > 0) {
		throw new HarnessFailure(`policy pack metadata invalid: ${metadataIssues[0] || "unknown metadata issue"}`, {
			details: {
				policy_pack_dir: policyPackDir,
				policy_pack_version: policyPackVersion,
				issues: metadataIssues,
				issue_count: metadataIssues.length,
			},
		});
	}
	const contractIssues = validatePolicyPackContract({
		policyPack: {
			version: policyPackVersion,
			overrides: config.policyPack?.overrides || {},
		},
		metadata: docs.metadata,
		policies: docs.policies,
	}).map((issue) => formatPolicyPackIssue(issue));
	if (contractIssues.length > 0) {
		throw new HarnessFailure(contractIssues[0] || "policy pack contract validation failed", {
			details: {
				policy_pack_dir: policyPackDir,
				policy_pack_version: policyPackVersion,
				issues: contractIssues,
				issue_count: contractIssues.length,
			},
		});
	}

	return {
		details: {
			policy_pack_dir: policyPackDir,
			policy_pack_version: policyPackVersion,
			issue_count: 0,
		},
	};
}
function runGraphValidatePhase(
	state: HarnessState,
	repoRoot: string,
	factoryRoot: string,
): { details: Record<string, unknown> } {
	const config = requireFactoryConfig(state);
	state.supervisorGraphPath = resolveSupervisorGraphPath({
		supervisorTickPath: config.pipeline.supervisor_tick,
		repoRoot,
		factoryRoot,
		factoryConfigPath: state.factoryConfigPath,
	});

	if (!existsSync(state.supervisorGraphPath)) {
		throw new HarnessFailure(`supervisor graph not found: ${state.supervisorGraphPath}`, {
			details: {
				supervisor_graph_path: state.supervisorGraphPath,
				pipeline_supervisor_tick: config.pipeline.supervisor_tick,
			},
		});
	}

	const loadedGraphSource = loadGraphSource(state.supervisorGraphPath, path.dirname(state.supervisorGraphPath));

	let parsedGraph: Graph;
	try {
		parsedGraph = parse(loadedGraphSource.sourceText);
	} catch (error) {
		throw new HarnessFailure(`supervisor graph parse failed: ${error instanceof Error ? error.message : String(error)}`, {
			details: {
				supervisor_graph_path: state.supervisorGraphPath,
				supervisor_graph_source_kind: loadedGraphSource.sourceKind,
			},
		});
	}

	const validationErrors = validate(parsedGraph);
	if (hasValidationErrors(validationErrors)) {
		throw new HarnessFailure("supervisor graph validation failed", {
			details: {
				supervisor_graph_path: state.supervisorGraphPath,
				supervisor_graph_source_kind: loadedGraphSource.sourceKind,
				validation_errors: validationErrors.map((error) => formatValidationError(error)),
			},
		});
	}

	state.supervisorGraph = parsedGraph;
	return {
		details: {
			supervisor_graph_path: state.supervisorGraphPath,
			supervisor_graph_source_kind: loadedGraphSource.sourceKind,
			warning_count: validationErrors.filter((error) => error.severity === "warning").length,
		},
	};
}
function runDotLintPhase(
	state: HarnessState,
	repoRoot: string,
	commandCwd: string,
	timeoutMs: number,
	runCommand: FactoryConformanceCommandRunner,
	lintScriptPathOverride?: string,
	skipMissingLintScript?: boolean,
	dotLintStrictWarnings?: boolean,
): { details: Record<string, unknown>; command?: string } {
	const supervisorGraphPath = requireSupervisorGraphPath(state);
	const loadedGraphSource = loadGraphSource(supervisorGraphPath, path.dirname(supervisorGraphPath));
	const lintScriptPath = lintScriptPathOverride || path.resolve(commandCwd, "scripts", "lint-dot.mjs");
	if (!existsSync(lintScriptPath)) {
		if (skipMissingLintScript) {
			return {
				details: {
					skipped: true,
					reason: "lint_script_not_found",
					lint_script_path: lintScriptPath,
				},
			};
		}
		throw new HarnessFailure(`lint-dot script not found: ${lintScriptPath}`, {
			details: { lint_script_path: lintScriptPath },
		});
	}

	const lintTargetPath = createDotLintTarget({
		repoRoot,
		supervisorGraphPath,
		sourceKind: loadedGraphSource.sourceKind,
		sourceText: loadedGraphSource.sourceText,
	});
	try {
		const command = runCommand({
			command: process.execPath,
			args: [
				lintScriptPath,
				...(dotLintStrictWarnings ? ["--strict-warnings"] : []),
				lintTargetPath,
			],
			cwd: commandCwd,
			env: process.env,
			timeoutMs,
		});
		if (!command.ok) {
			throw new HarnessFailure(`DOT lint failed: ${command.errorMessage || command.stderr || "non-zero exit"}`, {
				details: {
					supervisor_graph_path: supervisorGraphPath,
					supervisor_graph_source_kind: loadedGraphSource.sourceKind,
					lint_target_path: lintTargetPath,
					stdout: command.stdout,
					stderr: command.stderr,
					timed_out: command.timedOut,
				},
				command: command.command,
				exitCode: command.exitCode,
			});
		}

		return {
			details: {
				supervisor_graph_path: supervisorGraphPath,
				supervisor_graph_source_kind: loadedGraphSource.sourceKind,
				lint_target_path: lintTargetPath,
				stdout: command.stdout,
				stderr: command.stderr,
			},
			command: command.command,
		};
	} finally {
		cleanupDotLintTarget(lintTargetPath, loadedGraphSource.sourceKind);
	}
}
function createDotLintTarget(args: {
	repoRoot: string;
	supervisorGraphPath: string;
	sourceKind: "dot" | "workflow_source";
	sourceText: string;
}): string {
	if (args.sourceKind === "dot") {
		return args.supervisorGraphPath;
	}

	const generatedRuntimeGraphPath = resolveWorkflowSourceRuntimeGraphPath(args.repoRoot, args.supervisorGraphPath);
	if (generatedRuntimeGraphPath) {
		return generatedRuntimeGraphPath;
	}

	const renderedDotPath = path.join(
		path.dirname(args.supervisorGraphPath),
		`.conformance-lint-${process.pid}-${Date.now()}-${path.basename(args.supervisorGraphPath).replace(/\.workflow-source\.mjs$/u, "") || "workflow"}.dot`,
	);
	writeFileSync(renderedDotPath, args.sourceText);
	return renderedDotPath;
}

function cleanupDotLintTarget(targetPath: string, sourceKind: "dot" | "workflow_source"): void {
	if (sourceKind !== "workflow_source") return;
	if (!path.basename(targetPath).startsWith(".conformance-lint-")) return;
	rmSync(targetPath, { force: true });
}
function resolveWorkflowSourceRuntimeGraphPath(repoRoot: string, supervisorGraphPath: string): string {
	const workflowSourceDataPath = supervisorGraphPath.replace(/\.workflow-source\.mjs$/u, ".workflow-source.data.json");
	if (!existsSync(workflowSourceDataPath)) return "";
	try {
		const workflowSourceData = JSON.parse(readFileSync(workflowSourceDataPath, "utf8"));
		const runtimeGraphPath = String(workflowSourceData?.runtimeGraphPath || "").trim();
		if (!runtimeGraphPath) return "";
		const resolvedRuntimeGraphPath = path.resolve(repoRoot, runtimeGraphPath);
		return existsSync(resolvedRuntimeGraphPath) ? resolvedRuntimeGraphPath : "";
	} catch {
		return "";
	}
}
function runRecoveryOwnershipPhase(state: HarnessState): { details: Record<string, unknown> } {
	const graph = requireSupervisorGraph(state);
	const metadataByNodeId = extractGraphRecoveryMetadata(graph);
	const reachableNodeIds = reachableFromStart(graph);
	const missingNodeIds = [...reachableNodeIds]
		.filter((nodeId) => {
			const node = graph.nodes[nodeId];
			if (!node) return false;
			if (nodeHandlerType(node) === "start") return false;
			const metadata = metadataByNodeId.get(nodeId);
			if (!metadata) return true;
			return !isSupervisorOwnedRecovery(metadata) && !isApprovedRecoverySink(metadata);
		})
		.sort((left, right) => left.localeCompare(right, "en"));

	if (missingNodeIds.length > 0) {
		throw new HarnessFailure(
			`reachable non-start nodes missing recovery ownership metadata: ${missingNodeIds.join(", ")}`,
			{
				details: {
					missing_node_ids: missingNodeIds,
					reachable_node_count: reachableNodeIds.size,
				},
			},
		);
	}

	return {
		details: {
			reachable_node_count: reachableNodeIds.size,
			checked_node_count: Math.max(0, reachableNodeIds.size - 1),
		},
	};
}
async function runBenchmarkTelemetryPhase(args: {
	state: HarnessState;
	factoryRoot: string;
	repoRoot: string;
}): Promise<{ details: Record<string, unknown> }> {
	if (!args.state.factoryConfig) {
		runConfigSchemaPhase(args.state);
	}
	const config = requireFactoryConfig(args.state);
	const conformance = config.conformance;
	const warnOnly = conformance?.benchmark_telemetry_warn_only === true;
	const exemptions = Array.isArray(conformance?.benchmark_telemetry_exemptions)
		? conformance.benchmark_telemetry_exemptions
		: [];

	let evaluation: BenchmarkTelemetryPhaseEvaluation;
	try {
		evaluation = evaluateBenchmarkTelemetryPhase({
			factoryRoot: args.factoryRoot,
			repoRoot: args.repoRoot,
			exemptions,
		});
	} catch (error) {
		if (error instanceof BenchmarkTelemetryPhaseError) {
			throw new HarnessFailure(error.message, {
				details: error.details,
			});
		}
		throw error;
		}
		const details: Record<string, unknown> = {
			repo_root: args.repoRoot,
			...evaluation,
		};
		if (evaluation.error_count > 0 && warnOnly) {
		return {
			details: {
				...details,
				warned: true,
				warnings: evaluation.errors,
				violations: evaluation.violations,
			},
		};
	}

	if (evaluation.error_count > 0) {
		throw new HarnessFailure(`benchmark_telemetry failed with ${evaluation.error_count} violation(s)`, {
			details: {
				...details,
				errors: evaluation.errors,
				violations: evaluation.violations,
			},
		});
	}

	return {
		details: {
			...details,
			warned: false,
			violations: [],
		},
	};
}
function runRunDirIsolationPhase(
	state: HarnessState,
	repoRoot: string,
	factoryRoot: string,
	runsDirOverride?: string,
): { details: Record<string, unknown> } {
	const config = requireFactoryConfig(state);
	const isolation = getFactoryIsolationConfig(config);
	state.runtimePaths = resolveFactoryRuntimePaths(isolation, {
		runs: runsDirOverride || config.runs_dir,
		baseDir: repoRoot,
	});

	const resolvedRunsDir = path.resolve(state.runtimePaths.runs);
	const expectedSuffix = path.join(".hatch", config.factory_id, "runs");
	const hasFactoryScopedSuffix = resolvedRunsDir.endsWith(expectedSuffix);
	if (!hasFactoryScopedSuffix) {
		throw new HarnessFailure(
			`resolved runs dir must end with ${expectedSuffix} (received ${resolvedRunsDir})`,
			{
				details: {
					factory_id: config.factory_id,
					runs_dir: resolvedRunsDir,
					expected_suffix: expectedSuffix,
				},
			},
		);
	}

	if (isPathWithin(path.resolve(factoryRoot), resolvedRunsDir)) {
		throw new HarnessFailure("resolved runs dir must not be inside factory root", {
			details: {
				factory_root: path.resolve(factoryRoot),
				runs_dir: resolvedRunsDir,
			},
		});
	}

	return {
		details: {
			factory_root: path.resolve(factoryRoot),
			runtime_paths: state.runtimePaths,
			runs_dir: resolvedRunsDir,
		},
	};
}
interface SupervisorSmokeRun {
	runId: string;
	runsDir: string;
	runDir: string;
	statePath: string;
	command: string;
	cleanup: () => void;
}
function runOpsContractPhase(args: {
	state: HarnessState;
	repoRoot: string;
	factoryRoot: string;
	commandCwd: string;
	timeoutMs: number;
	runCommand: FactoryConformanceCommandRunner;
}): { details: Record<string, unknown>; command: string } {
	const config = requireFactoryConfig(args.state);
	const runtimePaths = requireRuntimePaths(args.state);
	const hatchBin = resolveCommandInvocation("hatch", args.commandCwd);
	const hatchOpsBin = resolveCommandInvocation("hatch-ops", args.commandCwd);
	const repoFlagValue = String(config.target_repo || "").trim();
	const scenariosRootDetails = runScenarioRootPhase(config, args.repoRoot, args.factoryRoot).details;
	const resolvedScenariosRoot = String(scenariosRootDetails["resolved_path"] || "");
	const destinationsJson = config.destinations ? JSON.stringify(config.destinations) : "";
	mkdirSync(runtimePaths.runs, { recursive: true });

	const probeEnv: NodeJS.ProcessEnv = {
		...process.env,
		HATCH_FACTORY_GITHUB_TOKEN: process.env.HATCH_FACTORY_GITHUB_TOKEN || "conformance-token",
		HATCH_FACTORY_CONFIG_PATH: args.state.factoryConfigPath,
		HATCH_FACTORY_ROOT: args.factoryRoot,
		HATCH_FACTORY_ID: config.factory_id,
		HATCH_TARGET_REPO: repoFlagValue,
		HATCH_GH_REPO: repoFlagValue,
		HATCH_CONTROL_PLANE_REPO: config.control_plane_repo,
		HATCH_KIND_ID: String(config.kind_id || ""),
		HATCH_INSTANCE_ID: String(config.instance_id || ""),
		HATCH_DESTINATIONS_JSON: destinationsJson,
		HATCH_RUNS_DIR: runtimePaths.runs,
		HATCH_SCENARIOS_ROOT: resolvedScenariosRoot,
		HATCH_CANONICAL_CHECKOUT_PATH: "", // prevent stale repo-path startup assertion
		FACTORY_CONTEXT_REPO_PATH: "",
	};

	const probes = [
		{
			name: "factory_status",
			command: hatchOpsBin,
			args: [
				"factory",
				"status",
				"--factory-root",
				args.factoryRoot,
				"--factory-id",
				config.factory_id,
				...(repoFlagValue ? ["--repo", repoFlagValue] : []),
				"--control-plane-repo",
				config.control_plane_repo,
				"--json",
			],
		},
		{
			name: "factory_tick_status",
			command: hatchOpsBin,
			args: [
				"factory",
				"tick-status",
				"--factory-root",
				args.factoryRoot,
				"--factory-id",
				config.factory_id,
				...(repoFlagValue ? ["--repo", repoFlagValue] : []),
				"--control-plane-repo",
				config.control_plane_repo,
				"--json",
			],
		},
	];

	const probeResults: Array<Record<string, unknown>> = [];
	for (const probe of probes) {
			const actualArgs = [...probe.command.argsPrefix, ...probe.args.filter((value): value is string => typeof value === "string")];
			const displayCommand = formatCommand(probe.command.displayCommand, probe.args.filter((value): value is string => typeof value === "string"));
			const command = args.runCommand({
				command: probe.command.command,
				args: actualArgs,
				cwd: args.commandCwd,
				env: probeEnv,
				timeoutMs: args.timeoutMs,
		});
		if (!command.ok) {
			const stderrTail = String(command.stderr || "").trim().slice(-300);
			throw new HarnessFailure(`ops contract probe failed (${probe.name}): ${command.errorMessage || "non-zero exit"} (exit=${command.exitCode}) stderr=${stderrTail || "(empty)"}`, {
				details: {
					probe: probe.name,
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
			throw new HarnessFailure(
				`ops contract probe output is not valid JSON (${probe.name})`,
				{
					details: { probe: probe.name, stdout: command.stdout, stderr: command.stderr },
					command: displayCommand,
				},
			);
		}

		probeResults.push({
			name: probe.name,
			command: displayCommand,
			exit_code: command.exitCode,
		});
	}

	return {
		details: {
			probe_count: probes.length,
			probes: probeResults,
		},
		command: probeResults.map((entry) => String(entry["command"] || "")).join(" && "),
	};
}
function phaseRunCommandHint(args: {
	phase: FactoryConformancePhase;
	state: HarnessState;
	commandCwd: string;
	repoRoot: string;
	factoryRoot: string;
	runsDirOverride?: string;
	lintScriptPath?: string;
	dotLintStrictWarnings?: boolean;
}): string {
	switch (args.phase) {
		case "intent_stack": {
			return formatIntentStackCommandHint({
				commandCwd: args.commandCwd,
				factoryRoot: args.factoryRoot,
			});
		}
		case "benchmark_telemetry": {
			return "";
		}
		case "dot_lint": {
			const supervisorGraphPath = args.state.supervisorGraphPath;
			if (!supervisorGraphPath) return "";
			const lintScriptPath = args.lintScriptPath || path.resolve(args.commandCwd, "scripts", "lint-dot.mjs");
			return formatCommand(process.execPath, [
				lintScriptPath,
				...(args.dotLintStrictWarnings ? ["--strict-warnings"] : []),
				supervisorGraphPath,
			]);
		}
		case "supervisor_tick_smoke": {
			const config = args.state.factoryConfig;
			if (!config) return "";
			const supervisorGraphPath = resolveConformanceSmokeGraphPath({
				config,
				factoryConfigPath: args.state.factoryConfigPath,
				supervisorGraphPath: requireSupervisorGraphPath(args.state),
				repoRoot: args.repoRoot,
				factoryRoot: args.factoryRoot,
			});
			const hatchBin = resolveCommandInvocation("hatch", args.commandCwd);
			const runId = "conformance-smoke-<generated>";
			const contextJson = JSON.stringify({
				repo: args.repoRoot,
				gh_repo: config.target_repo,
				control_plane: config.control_plane_repo,
				factory_id: config.factory_id,
			});
			return formatCommand(hatchBin.displayCommand, ["run", supervisorGraphPath, "--checkpoint", "--run-id", runId, "--context", contextJson]);
		}
		case "operational_e2e": {
			const config = args.state.factoryConfig;
			if (!config) return "";
			const hatchOpsBin = resolveCommandInvocation("hatch-ops", args.commandCwd);
			const commands = [
				formatCommand(hatchOpsBin.displayCommand, ["factory", "status", "--factory-root", args.factoryRoot, "--json"]),
				formatCommand(hatchOpsBin.displayCommand, ["factory", "tick-status", "--factory-root", args.factoryRoot, "--json"]),
			];
			return commands.join(" && ");
		}
		case "ops_contract": {
			const config = args.state.factoryConfig;
			if (!config) return "";
			const hatchOpsBin = resolveCommandInvocation("hatch-ops", args.commandCwd);
			const commands = [
				formatCommand(hatchOpsBin.displayCommand, ["factory", "status", "--factory-root", args.factoryRoot, "--json"]),
				formatCommand(hatchOpsBin.displayCommand, ["factory", "tick-status", "--factory-root", args.factoryRoot, "--json"]),
			];
			return commands.join(" && ");
		}
		default:
			return "";
	}
}
function resolveRequestedPhases(input: FactoryConformancePhase[] | undefined): FactoryConformancePhase[] {
	if (!input || input.length === 0) {
		return [...FACTORY_CONFORMANCE_PHASES];
	}

	const requested = new Set(input);
	for (const phase of requested) {
		if (!FACTORY_CONFORMANCE_PHASES.includes(phase)) {
			throw new Error(`unknown conformance phase: ${String(phase)}`);
		}
	}

	return FACTORY_CONFORMANCE_PHASES.filter((phase) => requested.has(phase));
}
function reachableFromStart(graph: Graph): Set<string> {
	const startNode = Object.values(graph.nodes).find((node) => nodeHandlerType(node) === "start");
	if (!startNode) {
		return new Set(Object.keys(graph.nodes));
	}

	const reachable = new Set<string>();
	const queue = [startNode.id];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || reachable.has(current)) continue;
		reachable.add(current);
		for (const edge of outgoingEdges(graph, current)) {
			if (!reachable.has(edge.to)) {
				queue.push(edge.to);
			}
		}
	}
	return reachable;
}
function requireFactoryConfig(state: HarnessState): FactoryConfigDocument {
	if (!state.factoryConfig) throw new HarnessFailure("config_schema phase must run before this phase");
	return state.factoryConfig;
}
function requireSupervisorGraph(state: HarnessState): Graph {
	if (!state.supervisorGraph) throw new HarnessFailure("graph_validate phase must run before this phase");
	return state.supervisorGraph;
}
function requireSupervisorGraphPath(state: HarnessState): string {
	if (!state.supervisorGraphPath) throw new HarnessFailure("graph_validate phase must run before this phase");
	return state.supervisorGraphPath;
}
function requireRuntimePaths(state: HarnessState): FactoryRuntimePaths {
	if (!state.runtimePaths) throw new HarnessFailure("run_dir_isolation phase must run before this phase");
	return state.runtimePaths;
}
