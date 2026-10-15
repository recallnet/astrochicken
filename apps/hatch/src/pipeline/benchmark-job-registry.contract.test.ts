import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadGraphSource } from "./graph-source.js";
import { parse } from "./parse.js";

const REGISTRY_PATH = join(import.meta.dirname, "../../../../docs/contracts/benchmark-job-registry.json");
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const BENCHMARK_SOURCE_ROOTS = [
	"factories/mothership/workflows",
	"packages/capability-coding/workflows",
	"packages/capability-merge/workflows",
	"packages/capability-product-judge/workflows",
	"packages/capability-goal-decomposition/workflows",
	"packages/capability-release-reporting/workflows",
	"packages/capability-software-development/workflows",
];

const REQUIRED_NODE_ATTRS = ["benchmark_job_id", "prompt_version", "role_version", "skill_id"] as const;
const BENCHMARKABLE_CLASSES = new Set([
	"coder",
	"reviewer",
	"goal_batch_reviewer",
	"goal_decomposer",
	"issue_quality_judge",
	"post_merge_judge",
	"supervisor",
	"merge_resolver",
	"release_narrator",
	"issue_writer",
]);

interface RegistryNodeRef {
	graph: string;
	node_id: string;
}

interface RegistryJob {
	job_id: string;
	description: string;
	nodes: RegistryNodeRef[];
}

interface RegistryDocument {
	schema_version: string;
	jobs: RegistryJob[];
}

function loadRegistry(): RegistryDocument {
	return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as RegistryDocument;
}

// @context:integration Benchmark contracts must compile canonical typed sources, not parse module text as DOT.
function loadGraph(graphFile: string) {
	return parse(loadGraphSource(graphFile, REPO_ROOT).sourceText);
}

function listAllBenchmarkableGraphFiles(): string[] {
	const graphFiles: string[] = [];
	function collect(directory: string): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) collect(absolutePath);
			else if (entry.name.endsWith(".workflow-source.mjs")) {
				const repositoryPath = relative(REPO_ROOT, absolutePath);
				graphFiles.push(repositoryPath.startsWith("packages/")
					? repositoryPath.replace(/^packages\/([^/]+)\//, "@hatch/$1/")
					: repositoryPath);
			}
		}
	}
	for (const sourceRoot of BENCHMARK_SOURCE_ROOTS) collect(join(REPO_ROOT, sourceRoot));
	expect(graphFiles.length).toBeGreaterThan(0);
	return graphFiles;
}

function registryKey(ref: RegistryNodeRef): string {
	return `${ref.graph}::${ref.node_id}`;
}

describe("benchmark job registry contract", () => {
	it("declares benchmark_job_registry/v1 and unique node ownership", () => {
		const registry = loadRegistry();
		expect(registry.schema_version).toBe("benchmark_job_registry/v1");
		expect(Array.isArray(registry.jobs)).toBe(true);
		expect(registry.jobs.length).toBeGreaterThan(0);

		const nodeOwnership = new Map<string, string>();

		for (const job of registry.jobs) {
			expect(job.job_id.length).toBeGreaterThan(0);
			expect(job.description.length).toBeGreaterThan(0);
			expect(Array.isArray(job.nodes)).toBe(true);
			expect(job.nodes.length).toBeGreaterThan(0);

			for (const ref of job.nodes) {
				expect(ref.graph.endsWith(".workflow-source.mjs")).toBe(true);
				expect(ref.node_id.length).toBeGreaterThan(0);
				const key = registryKey(ref);
				if (nodeOwnership.has(key)) {
					throw new Error(
						`registry duplicate node ownership: ${key} in both ${nodeOwnership.get(key)} and ${job.job_id}`,
					);
				}
				nodeOwnership.set(key, job.job_id);
			}
		}
	});

	it("ensures every registry node exists and carries required benchmark identity attributes", () => {
		const registry = loadRegistry();

		for (const job of registry.jobs) {
			for (const ref of job.nodes) {
				const graph = loadGraph(ref.graph);
				const node = graph.nodes[ref.node_id];
				expect(node, `missing node ${registryKey(ref)}`).toBeTruthy();

				const nodeClass = String(node?.attrs["class"] || "").trim();
				expect(
					BENCHMARKABLE_CLASSES.has(nodeClass),
					`${registryKey(ref)} must point to benchmarkable class node (got class=${nodeClass || "<empty>"})`,
				).toBe(true);

				for (const attr of REQUIRED_NODE_ATTRS) {
					const value = String(node?.attrs[attr] || "").trim();
					expect(value.length, `${registryKey(ref)} missing required attr ${attr}`).toBeGreaterThan(0);
				}

				expect(node?.attrs["benchmark_job_id"]).toBe(
					job.job_id,
					`${registryKey(ref)} benchmark_job_id must match registry job_id`,
				);
			}
		}
	});

	it("requires every benchmarkable LLM node in mothership + capability graphs to be registered", () => {
		const registry = loadRegistry();
		const registeredNodes = new Set<string>();
		for (const job of registry.jobs) {
			for (const ref of job.nodes) {
				registeredNodes.add(registryKey(ref));
			}
		}

		const graphFiles = listAllBenchmarkableGraphFiles();
		expect(graphFiles.length).toBeGreaterThan(0);

		const missing: string[] = [];
		for (const graphFile of graphFiles) {
			const graph = loadGraph(graphFile);
			for (const node of Object.values(graph.nodes)) {
				const nodeClass = String(node.attrs["class"] || "").trim();
				if (!BENCHMARKABLE_CLASSES.has(nodeClass)) continue;
				const key = `${graphFile}::${node.id}`;
				if (!registeredNodes.has(key)) {
					missing.push(key);
				}
			}
		}

		expect(missing).toEqual([]);
	});
});
