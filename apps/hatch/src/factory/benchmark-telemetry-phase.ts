import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { nodeHandlerType } from "../pipeline/graph.js";
import { parse } from "../pipeline/parse.js";

import type { Graph } from "../pipeline/graph.js";

const BENCHMARK_TELEMETRY_LLM_CLASSES = new Set([
	"coder",
	"reviewer",
	"supervisor",
	"merge_resolver",
	"judge",
	"issue_quality_judge",
	"post_merge_judge",
	"knowledge_worker",
	"goal_decomposer",
	"goal_batch_reviewer",
	"scenario_author",
	"release_narrator",
	"issue_writer",
]);

export interface BenchmarkTelemetryPhaseEvaluation {
	factory_id: string;
	graphs_dir: string;
	graph_count: number;
	checked_node_count: number;
	exempted_node_count: number;
	error_count: number;
	violation_count: number;
	errors: string[];
	violations: string[];
	exemptions: string[];
	skipped?: boolean;
	skip_reason?: string;
}

export class BenchmarkTelemetryPhaseError extends Error {
	readonly details: Record<string, unknown>;

	constructor(message: string, details: Record<string, unknown> = {}) {
		super(message);
		this.name = "BenchmarkTelemetryPhaseError";
		this.details = details;
	}
}

export function evaluateBenchmarkTelemetryPhase(args: {
	factoryRoot: string;
	repoRoot: string;
	exemptions: string[];
}): BenchmarkTelemetryPhaseEvaluation {
	const resolvedFactoryRoot = path.resolve(args.factoryRoot);
	const graphsDir = path.join(resolvedFactoryRoot, "graphs");
	if (!existsSync(graphsDir)) {
		return {
			factory_id: readFactoryId(path.join(resolvedFactoryRoot, "factory.config.json"), []),
			graphs_dir: graphsDir,
			graph_count: 0,
			checked_node_count: 0,
			exempted_node_count: 0,
			error_count: 0,
			violation_count: 0,
			errors: [],
			violations: [],
			exemptions: [],
			skipped: true,
			skip_reason: "no_graphs_dir",
		};
	}

	const exemptions = new Set((args.exemptions || []).map((value) => String(value || "").trim()).filter(Boolean));
	const graphFiles = listDotFiles(graphsDir);
	const errors: string[] = [];
	const factoryConfigPath = path.join(resolvedFactoryRoot, "factory.config.json");
	const factoryId = readFactoryId(factoryConfigPath, errors);
	let checkedNodeCount = 0;
	let exemptedNodeCount = 0;

	for (const graphFile of graphFiles) {
		const graphPath = path.join(graphsDir, graphFile);
		let graph: Graph;
		try {
			graph = parse(readFileSync(graphPath, "utf8"));
		} catch (error) {
			throw new BenchmarkTelemetryPhaseError(`benchmark telemetry phase failed to parse graph: ${graphFile}`, {
				graphs_dir: graphsDir,
				graph: graphFile,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		for (const node of Object.values(graph.nodes || {})) {
			const className = String(node.attrs?.["class"] || "").trim().toLowerCase();
			if (!BENCHMARK_TELEMETRY_LLM_CLASSES.has(className)) continue;
			if (nodeHandlerType(node) === "tool") continue;
			if (exemptions.has(node.id)) {
				exemptedNodeCount += 1;
				continue;
			}

			checkedNodeCount += 1;
			const benchmarkJobId = String(node.attrs?.["benchmark_job_id"] || "").trim();
			const promptVersion = String(node.attrs?.["prompt_version"] || "").trim();
			const roleVersion = String(node.attrs?.["role_version"] || "").trim();
			const skillId = String(node.attrs?.["skill_id"] || "").trim();
			if (!benchmarkJobId || !promptVersion || !roleVersion || !skillId) {
				errors.push(`${graphFile}: node ${node.id} (class=${className}) is missing benchmark_job_id/prompt_version/role_version/skill_id`);
			}
		}
	}

	return {
		factory_id: factoryId,
		graphs_dir: graphsDir,
		graph_count: graphFiles.length,
		checked_node_count: checkedNodeCount,
		exempted_node_count: exemptedNodeCount,
		error_count: errors.length,
		violation_count: errors.length,
		errors,
		violations: errors,
		exemptions: [...exemptions],
	};
}

function readFactoryId(factoryConfigPath: string, errors: string[]): string {
	if (!existsSync(factoryConfigPath)) {
		errors.push(`factory config missing: ${factoryConfigPath}`);
		return "";
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(factoryConfigPath, "utf8"));
	} catch (error) {
		errors.push(
			`factory config invalid JSON (${factoryConfigPath}): ${error instanceof Error ? error.message : String(error)}`,
		);
		return "";
	}

	const factoryId = extractFactoryId(parsed);
	if (!factoryId) {
		errors.push(`factory config missing non-empty factory_id: ${factoryConfigPath}`);
		return "";
	}
	return factoryId;
}

function extractFactoryId(value: unknown): string {
	if (!isPlainObject(value)) return "";
	const factoryId = value["factory_id"];
	return typeof factoryId === "string" ? factoryId.trim() : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listDotFiles(graphsDir: string): string[] {
	const pending = [graphsDir];
	const dotFiles: string[] = [];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const absolute = path.join(current, entry.name);
			if (entry.isDirectory()) {
				pending.push(absolute);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".dot")) continue;
			dotFiles.push(path.relative(graphsDir, absolute).replaceAll("\\", "/"));
		}
	}
	return dotFiles.sort((left, right) => left.localeCompare(right, "en"));
}
