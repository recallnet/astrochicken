import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BENCHMARK_IDENTITY_RULE_ID = "benchmark_identity.missing_attributes";
const BENCHMARK_JOB_ID_REQUIRED_RULE_ID = "telemetry.benchmark_identity_required";
const BENCHMARK_LLM_NODE_CLASSES = new Set(["coder", "reviewer", "judge", "supervisor", "knowledge_worker"]);
const BENCHMARK_REQUIRED_NODE_ATTRIBUTES = ["benchmark_job_id", "prompt_version", "role_version", "skill_id"];
const BENCHMARK_JOB_REGISTRY_PATH = resolve(
	fileURLToPath(new URL("../../docs/contracts/benchmark-job-id-registry.json", import.meta.url)),
);

function loadBenchmarkJobRegistryIds() {
	if (!existsSync(BENCHMARK_JOB_REGISTRY_PATH)) return { loaded: false, ids: new Set() };
	try {
		const parsed = JSON.parse(readFileSync(BENCHMARK_JOB_REGISTRY_PATH, "utf8"));
		const ids = new Set();
		const jobs = Array.isArray(parsed?.job_ids) ? parsed.job_ids : [];
		for (const job of jobs) {
			const id = String(job?.job_id || "").trim();
			if (id) ids.add(id);
		}
		return { loaded: true, ids };
	} catch {
		return { loaded: false, ids: new Set() };
	}
}

const BENCHMARK_JOB_REGISTRY = loadBenchmarkJobRegistryIds();

export function benchmarkIdentityDiagnosticsForNode({ file, nodeId, attrs, line, column }) {
	const nodeType = String(attrs?.type || "").trim().toLowerCase();
	if (nodeType === "tool") return [];

	const nodeClass = String(attrs?.class || "").trim().toLowerCase();
	if (!BENCHMARK_LLM_NODE_CLASSES.has(nodeClass)) return [];

	const benchmarkJobId = String(attrs?.benchmark_job_id || "").trim();
	if (!benchmarkJobId) {
		return [
			{
				file,
				severity: "error",
				rule_id: BENCHMARK_JOB_ID_REQUIRED_RULE_ID,
				message: `LLM-class node "${nodeId}" (class=${nodeClass}) is missing required "benchmark_job_id" annotation`,
				line,
				column,
				node: nodeId,
			},
		];
	}

	const missingAttrs = BENCHMARK_REQUIRED_NODE_ATTRIBUTES
		.filter((attr) => attr !== "benchmark_job_id")
		.filter((attr) => !String(attrs?.[attr] || "").trim());
	if (missingAttrs.length > 0) {
		return [
			{
				file,
				severity: "error",
				rule_id: BENCHMARK_IDENTITY_RULE_ID,
				message: `LLM node "${nodeId}" (class=${nodeClass}) missing benchmark identity attributes: ${missingAttrs.join(", ")}`,
				line,
				column,
				node: nodeId,
			},
		];
	}

	if (BENCHMARK_JOB_REGISTRY.loaded && BENCHMARK_JOB_REGISTRY.ids.size > 0 && !BENCHMARK_JOB_REGISTRY.ids.has(benchmarkJobId)) {
		return [
			{
				file,
				severity: "error",
				rule_id: BENCHMARK_IDENTITY_RULE_ID,
				message: `LLM node "${nodeId}" benchmark_job_id="${benchmarkJobId}" is not registered in docs/contracts/benchmark-job-id-registry.json`,
				line,
				column,
				node: nodeId,
			},
		];
	}

	return [];
}
