import { existsSync } from "node:fs";
import path from "node:path";

import {
	FACTORY_CONFORMANCE_PHASES,
	runFactoryConformanceHarness,
	type FactoryConformanceHarnessResult,
	type FactoryConformancePhase,
	type FactoryConformancePhaseEvent,
	type RunFactoryConformanceHarnessOptions,
} from "./conformance-harness.js";
import { parseFactoryContextOverrideArgs } from "../cli/factory-context-overrides.js";

const FACTORY_CONFIG_FILE = "factory.config.json";

interface ParsedConformanceArgs {
	factoryRoot: string;
	repoRoot: string;
	runsDir: string;
	json: boolean;
	help: boolean;
	phases: FactoryConformancePhase[];
}

interface RunFactoryConformanceCliDependencies {
	cwd?: string;
	stdout?: NodeJS.WriteStream;
	stderr?: NodeJS.WriteStream;
	runHarness?: (options: RunFactoryConformanceHarnessOptions) => Promise<FactoryConformanceHarnessResult>;
}

function usage(): string {
	return [
		"usage: hatch factory conformance [--factory-root <path>] [--factory-config-path <path>] [--factory-id <id>] [--repo-root <path>] [--runs-dir <path>] [--phase <name>] [--json]",
		"",
		"Run deterministic factory conformance phases against a factory config + supervisor graph.",
	].join("\n");
}

function trim(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function resolvePath(rawPath: string, cwd: string): string {
	const normalized = trim(rawPath);
	if (!normalized) return "";
	return path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
}

function hasFactoryConfig(factoryRoot: string): boolean {
	return existsSync(path.join(factoryRoot, FACTORY_CONFIG_FILE));
}

function findFactoryRootInAncestors(args: {
	anchorDir: string;
	factoryId: string;
}): string {
	const scopedFactoryId = trim(args.factoryId) || "mothership";
	let current = path.resolve(args.anchorDir || process.cwd());
	let previous = "";
	while (current && current !== previous) {
		const candidate = path.join(current, "factories", scopedFactoryId);
		if (hasFactoryConfig(candidate)) return candidate;
		previous = current;
		current = path.dirname(current);
	}
	return "";
}

function resolveFactoryRoot(args: {
	cwd: string;
	factoryRootFlag: string;
	factoryConfigPathFlag: string;
	factoryIdFlag: string;
}): string {
	const explicitConfigPath = resolvePath(args.factoryConfigPathFlag, args.cwd);
	if (explicitConfigPath) {
		return path.dirname(explicitConfigPath);
	}

	const explicitFactoryRoot = resolvePath(args.factoryRootFlag, args.cwd);
	const explicitFactoryId = trim(args.factoryIdFlag) || "mothership";
	const candidates: string[] = [];

	if (explicitFactoryRoot) {
		candidates.push(explicitFactoryRoot);
		candidates.push(path.join(explicitFactoryRoot, "factories", explicitFactoryId));
		candidates.push(path.join(explicitFactoryRoot, explicitFactoryId));
	}

	if (!explicitFactoryRoot) {
		candidates.push(path.resolve(args.cwd, "factories", explicitFactoryId));
	}

	for (const candidate of candidates) {
		if (hasFactoryConfig(candidate)) return candidate;
	}

	const searchAnchor = explicitFactoryRoot || args.cwd;
	const ancestorMatch = findFactoryRootInAncestors({
		anchorDir: searchAnchor,
		factoryId: explicitFactoryId,
	});
	if (ancestorMatch) return ancestorMatch;

	if (explicitFactoryRoot) return explicitFactoryRoot;
	return path.resolve(args.cwd, "factories", explicitFactoryId);
}

function phaseDependencies(phase: FactoryConformancePhase): FactoryConformancePhase[] {
	switch (phase) {
		case "config_schema":
			return [];
		case "intent_stack":
			return ["config_schema"];
		case "policy_pack_conformance":
			return ["config_schema"];
		case "graph_validate":
			return ["policy_pack_conformance"];
		case "dot_lint":
			return ["graph_validate"];
		case "recovery_ownership":
			return ["graph_validate"];
		case "run_dir_isolation":
			return ["config_schema"];
		case "skill_loading":
			return ["config_schema"];
		case "scenario_root":
			return ["config_schema"];
		case "benchmark_telemetry":
			return ["config_schema"];
		case "supervisor_tick_smoke":
			return ["graph_validate"];
		case "operational_e2e":
			return ["graph_validate", "run_dir_isolation", "scenario_root", "supervisor_tick_smoke"];
		case "ops_contract":
			return ["run_dir_isolation"];
		default:
			return [];
	}
}

function expandPhaseSelection(selected: FactoryConformancePhase[]): FactoryConformancePhase[] {
	const selectedSet = new Set<FactoryConformancePhase>();
	const visit = (phase: FactoryConformancePhase) => {
		if (selectedSet.has(phase)) return;
		for (const dependency of phaseDependencies(phase)) {
			visit(dependency);
		}
		selectedSet.add(phase);
	};
	for (const phase of selected) {
		visit(phase);
	}
	return FACTORY_CONFORMANCE_PHASES.filter((phase) => selectedSet.has(phase));
}

function parseConformanceArgs(rawArgs: string[], cwd: string): { parsed: ParsedConformanceArgs; error: string } {
	const { flags, args } = parseFactoryContextOverrideArgs(rawArgs);

	let repoRoot = "";
	let runsDir = trim(flags.runsDir);
	let json = false;
	let help = false;
	const phases: FactoryConformancePhase[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] || "";
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--repo-root") {
			const value = args[index + 1] || "";
			if (!trim(value)) {
				return { parsed: emptyParsedArgs(), error: "--repo-root requires a path" };
			}
			repoRoot = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--repo-root=")) {
			repoRoot = arg.slice("--repo-root=".length);
			continue;
		}
		if (arg === "--runs-dir") {
			const value = args[index + 1] || "";
			if (!trim(value)) {
				return { parsed: emptyParsedArgs(), error: "--runs-dir requires a path" };
			}
			runsDir = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--runs-dir=")) {
			runsDir = arg.slice("--runs-dir=".length);
			continue;
		}
		if (arg === "--phase") {
			const value = trim(args[index + 1] || "");
			if (!value) {
				return { parsed: emptyParsedArgs(), error: "--phase requires a phase name" };
			}
			if (!FACTORY_CONFORMANCE_PHASES.includes(value as FactoryConformancePhase)) {
				return { parsed: emptyParsedArgs(), error: `unknown conformance phase: ${value}` };
			}
			phases.push(value as FactoryConformancePhase);
			index += 1;
			continue;
		}
		if (arg.startsWith("--phase=")) {
			const value = trim(arg.slice("--phase=".length));
			if (!value) {
				return { parsed: emptyParsedArgs(), error: "--phase requires a phase name" };
			}
			if (!FACTORY_CONFORMANCE_PHASES.includes(value as FactoryConformancePhase)) {
				return { parsed: emptyParsedArgs(), error: `unknown conformance phase: ${value}` };
			}
			phases.push(value as FactoryConformancePhase);
			continue;
		}

		return { parsed: emptyParsedArgs(), error: `unknown factory conformance option: ${arg}` };
	}

	const parsed: ParsedConformanceArgs = {
		factoryRoot: resolveFactoryRoot({
			cwd,
			factoryRootFlag: flags.factoryRoot,
			factoryConfigPathFlag: flags.factoryConfigPath,
			factoryIdFlag: flags.factoryId,
		}),
		repoRoot: resolvePath(repoRoot, cwd),
		runsDir: resolvePath(runsDir, cwd),
		json,
		help,
		phases: phases.length > 0 ? expandPhaseSelection(phases) : [],
	};

	return { parsed, error: "" };
}

function emptyParsedArgs(): ParsedConformanceArgs {
	return {
		factoryRoot: "",
		repoRoot: "",
		runsDir: "",
		json: false,
		help: false,
		phases: [],
	};
}

function emitPhaseEvent(stderr: NodeJS.WriteStream, event: FactoryConformancePhaseEvent): void {
	if (event.action === "run") {
		const parts = [
			`factory_conformance phase=${event.phase}`,
			"action=run",
		];
		if (event.phase_label) parts.push(`label=${JSON.stringify(event.phase_label)}`);
		if (event.command) parts.push(`command=${JSON.stringify(event.command)}`);
		stderr.write(`${parts.join(" ")}\n`);
		return;
	}

	const parts = [
		`factory_conformance phase=${event.phase}`,
		`result=${event.ok ? "ok" : "fail"}`,
		`duration_ms=${Number.isFinite(event.duration_ms) ? Number(event.duration_ms) : 0}`,
	];
	if (event.phase_label) parts.push(`label=${JSON.stringify(event.phase_label)}`);
	if (event.command) parts.push(`command=${JSON.stringify(event.command)}`);
	if (event.error) parts.push(`error=${JSON.stringify(event.error)}`);
	if (Number.isInteger(event.exit_code)) parts.push(`exit=${event.exit_code}`);
	stderr.write(`${parts.join(" ")}\n`);
}

export async function runFactoryConformanceCommand(
	rawArgs: string[],
	deps: RunFactoryConformanceCliDependencies = {},
): Promise<number> {
	const cwd = deps.cwd || process.cwd();
	const stdout = deps.stdout || process.stdout;
	const stderr = deps.stderr || process.stderr;
	const runHarness = deps.runHarness || runFactoryConformanceHarness;

	const { parsed, error } = parseConformanceArgs(rawArgs, cwd);
	if (error) {
		stderr.write(`${error}\n`);
		stderr.write(`${usage()}\n`);
		return 1;
	}

	if (parsed.help) {
		stdout.write(`${usage()}\n`);
		return 0;
	}

	const result = await runHarness({
		factoryRoot: parsed.factoryRoot,
		repoRoot: parsed.repoRoot || undefined,
		runsDir: parsed.runsDir || undefined,
		phases: parsed.phases.length > 0 ? parsed.phases : undefined,
		commandCwd: cwd,
		onPhaseEvent(event) {
			emitPhaseEvent(stderr, event);
		},
	});

	stderr.write(`factory_conformance result=${result.ok ? "ok" : "fail"} failed_phase=${result.failed_phase || ""}\n`);
	if (parsed.json) {
		stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	}

	return result.ok ? 0 : 1;
}
