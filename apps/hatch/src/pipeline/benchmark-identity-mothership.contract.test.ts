import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { parse } from "./parse.js";
import { BENCHMARK_IDENTITY_REQUIRED_FIELDS, assertBenchmarkIdentityContract } from "./telemetry-benchmark-identity.js";

const MOTHERSHIP_GRAPHS_DIR = join(import.meta.dirname, "../../../../factories/mothership/graphs");
const CAPABILITY_GOAL_DECOMPOSITION_GRAPHS_DIR = join(import.meta.dirname, "../../../../packages/capability-goal-decomposition/graphs");
const CAPABILITY_RELEASE_REPORTING_GRAPHS_DIR = join(import.meta.dirname, "../../../../packages/capability-release-reporting/graphs");
const REGISTRY_PATH = join(import.meta.dirname, "../../../../docs/contracts/benchmark-job-registry.json");
const BENCHMARKABLE_CLASSES = new Set([
	"coder",
	"reviewer",
	"goal_batch_reviewer",
	"goal_decomposer",
	"issue_quality_judge",
	"supervisor",
	"merge_resolver",
	"post_merge_judge",
	"release_narrator",
]);

interface RegistryJob {
	job_id: string;
}

interface RegistryDoc {
	jobs: RegistryJob[];
}

function loadRegistryJobIds(): Set<string> {
	const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as RegistryDoc;
	const ids = new Set<string>();
	for (const job of parsed.jobs || []) {
		const id = String(job?.job_id || "").trim();
		if (id) ids.add(id);
	}
	return ids;
}

describe("benchmark identity mothership contract", () => {
	it("structural: every benchmarkable LLM node carries benchmark identity attrs with valid formats and registered job_id", () => {
		const registryJobIds = loadRegistryJobIds();
		const graphFiles = readdirSync(MOTHERSHIP_GRAPHS_DIR).filter((file) => file.endsWith(".dot")).sort();
		expect(graphFiles.length).toBeGreaterThan(0);

		const promptVersionPattern = /^\d{4}-\d{2}-\d{2}\.r\d+$/;
		const semverPattern = /^\d+\.\d+\.\d+$/;

		for (const graphFile of graphFiles) {
			const graph = parse(readFileSync(join(MOTHERSHIP_GRAPHS_DIR, graphFile), "utf8"));
			for (const node of Object.values(graph.nodes)) {
				const nodeClass = String(node.attrs.class || "").trim();
				if (!BENCHMARKABLE_CLASSES.has(nodeClass)) continue;

				const benchmarkJobId = String(node.attrs.benchmark_job_id || "").trim();
				const promptVersion = String(node.attrs.prompt_version || "").trim();
				const roleVersion = String(node.attrs.role_version || "").trim();
				const skillId = String(node.attrs.skill_id || "").trim();

				expect(benchmarkJobId.length, `${graphFile}::${node.id} missing benchmark_job_id`).toBeGreaterThan(0);
				expect(promptVersion.length, `${graphFile}::${node.id} missing prompt_version`).toBeGreaterThan(0);
				expect(roleVersion.length, `${graphFile}::${node.id} missing role_version`).toBeGreaterThan(0);
				expect(skillId.length, `${graphFile}::${node.id} missing skill_id`).toBeGreaterThan(0);
				expect(promptVersionPattern.test(promptVersion), `${graphFile}::${node.id} prompt_version must match YYYY-MM-DD.rN`).toBe(true);
				expect(semverPattern.test(roleVersion), `${graphFile}::${node.id} role_version must be semver`).toBe(true);
				expect(registryJobIds.has(benchmarkJobId), `${graphFile}::${node.id} benchmark_job_id=${benchmarkJobId} must be in registry`).toBe(true);
			}
		}
	});

	it("engine simulation: coder+reviewer nodes from wave_issue_execute satisfy benchmark identity contract", async () => {
		const graph = parse(readFileSync(join(MOTHERSHIP_GRAPHS_DIR, "goal_issue_execute.dot"), "utf8"));
		const build = graph.nodes["build"];
		const review = graph.nodes["review"];
		expect(build).toBeTruthy();
		expect(review).toBeTruthy();
		expect(String(build?.attrs.class || "")).toBe("coder");
		expect(String(review?.attrs.class || "")).toBe("reviewer");

		for (const node of [build, review]) {
			const inline = parse(`
			digraph bench_inline {
				start [shape=Mdiamond]
				${node.id} [shape=box class="${String(node.attrs.class || "")}"
					llm_model="openai/gpt-5.3-codex"
					llm_provider="openrouter"
					benchmark_job_id="${String(node.attrs.benchmark_job_id || "")}"
					prompt_version="${String(node.attrs.prompt_version || "")}"
					role_version="${String(node.attrs.role_version || "")}"
					skill_id="${String(node.attrs.skill_id || "")}"
					label="${String(node.attrs.label || node.id)}"]
				done [shape=Msquare]
				start -> ${node.id} -> done
			}
			`);

			const registry = new HandlerRegistry();
			registry.register("codergen", {
				async execute() {
					return { status: StageStatus.Completed, output: "ok" };
				},
			});

			const events: Event[] = [];
			const bus = new EventBus();
			bus.on((event) => events.push(event));

			const ctx = new Context({ factory_id: "mothership", repo: "recallnet/astrochicken" });
			ctx.set("__run_id", `benchmark-sim-${node.id}`);
			ctx.set("prompt_hash", "sha256:benchmark-sim");

			const engine = new Engine(inline, registry, { context: ctx, eventBus: bus });
			await engine.run();

			const stageStart = events.find((event) => event.kind === "stage.start" && event.nodeId === node.id);
			expect(stageStart).toBeTruthy();
			const violation = assertBenchmarkIdentityContract({
				eventKind: "stage.start",
				data: (stageStart?.data || {}) as Record<string, string>,
				nodeAttrs: node.attrs,
			});
			expect(violation).toBeNull();
		}
	});

	it("quality.signal scorecard fields include quality score/grade + retry class + first_attempt flag", () => {
		const scorecardData: Record<string, string> = {
			factory_id: "mothership",
			graph_id: "goal_issue_execute",
			node_id: "build",
			handler_type: "tool",
			model: "openai/gpt-5.3-codex",
			provider: "openrouter",
			prompt_hash: "sha256:test",
			job_id: "goal.execute.issue.build",
			prompt_version: "2026-03-09.r1",
			role_version: "1.0.0",
			skill_id: "goal.execute.issue",
			"hatch.job_id": "goal.execute.issue.build",
			"hatch.prompt_version": "2026-03-09.r1",
			"hatch.role_version": "1.0.0",
			"hatch.skill_id": "goal.execute.issue",
			langfuse_quality_score: "0.90",
			"hatch.retry_class": "retry_pass",
			"hatch.first_attempt_pass": "false",
		};

		expect(String(scorecardData.langfuse_quality_score || scorecardData.langfuse_quality_grade || "").trim().length).toBeGreaterThan(0);
		expect(String(scorecardData["hatch.retry_class"] || "").trim().length).toBeGreaterThan(0);
		expect(String(scorecardData["hatch.first_attempt_pass"] || "").trim().length).toBeGreaterThan(0);
		for (const requiredField of BENCHMARK_IDENTITY_REQUIRED_FIELDS) {
			expect(String(scorecardData[requiredField] || "").trim().length, `missing required benchmark field ${requiredField}`).toBeGreaterThan(0);
		}
		const violation = assertBenchmarkIdentityContract({
			eventKind: "quality.signal",
			data: scorecardData,
			nodeAttrs: {
				benchmark_job_id: "goal.execute.issue.build",
				prompt_version: "2026-03-09.r1",
				role_version: "1.0.0",
				skill_id: "goal.execute.issue",
			},
		});
		expect(violation).toBeNull();
	});

	it("assertBenchmarkIdentityContract does not throw when model/provider are missing from capability-package graphs", () => {
		// Capability-package graphs like goal_intake_decompose.dot have
		// benchmark_job_id but no stylesheet import, so model and provider
		// are empty in stage.start event data. The assertion must fail-open
		// (return the violation) rather than throw, because crashing a
		// production pipeline over a telemetry gap is always worse than
		// incomplete telemetry.
		const data: Record<string, string> = {
			factory_id: "mothership",
			graph_id: "goal_intake_decompose",
			node_id: "analyze",
			handler_type: "agent.kw",
			model: "",          // missing — no stylesheet applied
			provider: "",       // missing — no stylesheet applied
			prompt_hash: "sha256:test",
			job_id: "goal.decompose.analyze",
			prompt_version: "2026-03-09.r1",
			role_version: "1.0.0",
			skill_id: "goal.decompose",
			"hatch.job_id": "goal.decompose.analyze",
			"hatch.prompt_version": "2026-03-09.r1",
			"hatch.role_version": "1.0.0",
			"hatch.skill_id": "goal.decompose",
		};

		const result = assertBenchmarkIdentityContract({
			eventKind: "stage.start",
			data,
			nodeAttrs: { benchmark_job_id: "goal.decompose.analyze" },
		});
		// Must NOT throw — fail-open
		expect(result).toBeDefined();
		expect(result?.violation).toBe(true);
		expect(result?.missing).toContain("model");
		expect(result?.missing).toContain("provider");
	});

	it("assertBenchmarkIdentityContract returns null when all fields are present", () => {
		const data: Record<string, string> = {
			factory_id: "mothership",
			graph_id: "goal_issue_execute",
			node_id: "build",
			handler_type: "tool",
			model: "openai/gpt-5.3-codex",
			provider: "openrouter",
			prompt_hash: "sha256:test",
			job_id: "goal.execute.issue.build",
			prompt_version: "2026-03-09.r1",
			role_version: "1.0.0",
			skill_id: "goal.execute.issue",
			"hatch.job_id": "goal.execute.issue.build",
			"hatch.prompt_version": "2026-03-09.r1",
			"hatch.role_version": "1.0.0",
			"hatch.skill_id": "goal.execute.issue",
		};

		const result = assertBenchmarkIdentityContract({
			eventKind: "stage.start",
			data,
			nodeAttrs: { benchmark_job_id: "goal.execute.issue.build" },
		});
		expect(result).toBeNull();
	});

	it("registry shape includes at least five benchmark jobs covering main benchmarkable classes", () => {
		const registryJobIds = loadRegistryJobIds();
		expect(registryJobIds.size).toBeGreaterThanOrEqual(5);

		const mothershipGraphFiles = readdirSync(MOTHERSHIP_GRAPHS_DIR).filter((file) => file.endsWith(".dot")).sort();
		const goalDecompositionGraphFiles = readdirSync(CAPABILITY_GOAL_DECOMPOSITION_GRAPHS_DIR).filter((file) => file.endsWith(".dot")).sort();
		const releaseReportingGraphFiles = readdirSync(CAPABILITY_RELEASE_REPORTING_GRAPHS_DIR).filter((file) => file.endsWith(".dot")).sort();
		expect(mothershipGraphFiles.length).toBeGreaterThan(0);
		expect(goalDecompositionGraphFiles.length).toBeGreaterThan(0);
		expect(releaseReportingGraphFiles.length).toBeGreaterThan(0);

		const classCoverage = new Set<string>();
		for (const graphFile of mothershipGraphFiles) {
			const graph = parse(readFileSync(join(MOTHERSHIP_GRAPHS_DIR, graphFile), "utf8"));
			for (const node of Object.values(graph.nodes)) {
				const nodeClass = String(node.attrs.class || "").trim();
				if (!BENCHMARKABLE_CLASSES.has(nodeClass)) continue;
				const jobId = String(node.attrs.benchmark_job_id || "").trim();
				if (registryJobIds.has(jobId)) {
					classCoverage.add(nodeClass);
				}
			}
		}
		for (const graphFile of releaseReportingGraphFiles) {
			const graph = parse(readFileSync(join(CAPABILITY_RELEASE_REPORTING_GRAPHS_DIR, graphFile), "utf8"));
			for (const node of Object.values(graph.nodes)) {
				const nodeClass = String(node.attrs.class || "").trim();
				if (!BENCHMARKABLE_CLASSES.has(nodeClass)) continue;
				const jobId = String(node.attrs.benchmark_job_id || "").trim();
				if (registryJobIds.has(jobId)) {
					classCoverage.add(nodeClass);
				}
			}
		}
		for (const graphFile of goalDecompositionGraphFiles) {
			const graph = parse(readFileSync(join(CAPABILITY_GOAL_DECOMPOSITION_GRAPHS_DIR, graphFile), "utf8"));
			for (const node of Object.values(graph.nodes)) {
				const nodeClass = String(node.attrs.class || "").trim();
				if (!BENCHMARKABLE_CLASSES.has(nodeClass)) continue;
				const jobId = String(node.attrs.benchmark_job_id || "").trim();
				if (registryJobIds.has(jobId)) {
					classCoverage.add(nodeClass);
				}
			}
		}

		expect(classCoverage.has("coder")).toBe(true);
		expect(classCoverage.has("reviewer")).toBe(true);
		expect(classCoverage.has("goal_batch_reviewer")).toBe(true);
		expect(classCoverage.has("goal_decomposer")).toBe(true);
		expect(classCoverage.has("issue_quality_judge")).toBe(true);
		expect(classCoverage.has("post_merge_judge")).toBe(true);
		expect(classCoverage.has("supervisor")).toBe(true);
		expect(classCoverage.has("merge_resolver")).toBe(true);
		expect(classCoverage.has("release_narrator")).toBe(true);
	});
});
