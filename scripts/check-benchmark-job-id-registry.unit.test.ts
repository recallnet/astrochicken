import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runBenchmarkJobIdRegistryCheck } from "./check-benchmark-job-id-registry.ts";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scriptPath = join(repoRoot, "scripts", "check-benchmark-job-id-registry.mjs");

function fixtureDir() {
	const root = mkdtempSync(join(tmpdir(), "benchmark-job-id-registry-"));
	const docsContracts = join(root, "docs", "contracts");
	const graphsDir = join(root, "factories", "mothership", "graphs");
	mkdirSync(docsContracts, { recursive: true });
	mkdirSync(graphsDir, { recursive: true });
	return { root, docsContracts, graphsDir };
}

test("runBenchmarkJobIdRegistryCheck passes for registered graph job ids", () => {
	const { docsContracts, graphsDir } = fixtureDir();
	const registryPath = join(docsContracts, "benchmark-job-id-registry.json");
	writeFileSync(
		registryPath,
		JSON.stringify({
			schema_version: "benchmark_job_id_registry/v1",
			job_ids: [
				{ job_id: "wave.execute.issue.build", graph_id: "wave_issue_execute", node_ids: ["build"], handler_type: "coder" },
			],
		}),
	);
	writeFileSync(
		join(graphsDir, "wave_issue_execute.dot"),
		'digraph t { build [class="coder" benchmark_job_id="wave.execute.issue.build"]; }\n',
	);

	const result = runBenchmarkJobIdRegistryCheck({ registryPath, graphsDir });
	assert.equal(result.ok, true);
	assert.equal(result.violations.length, 0);
	assert.equal(result.checked, 1);
	assert.equal(result.job_ids, 1);
});

test("runBenchmarkJobIdRegistryCheck fails for duplicate registry job_id", () => {
	const { docsContracts, graphsDir } = fixtureDir();
	const registryPath = join(docsContracts, "benchmark-job-id-registry.json");
	writeFileSync(
		registryPath,
		JSON.stringify({
			schema_version: "benchmark_job_id_registry/v1",
			job_ids: [
				{ job_id: "dup.id", graph_id: "g1", node_ids: ["n1"], handler_type: "coder" },
				{ job_id: "dup.id", graph_id: "g2", node_ids: ["n2"], handler_type: "reviewer" },
			],
		}),
	);
	writeFileSync(join(graphsDir, "wave_issue_execute.dot"), 'digraph t { build [benchmark_job_id="dup.id"]; }\n');

	const result = runBenchmarkJobIdRegistryCheck({ registryPath, graphsDir });
	assert.equal(result.ok, false);
	assert.match(JSON.stringify(result.violations), /duplicate_job_id/);
});

test("CLI fails for unknown graph benchmark_job_id with deterministic marker", () => {
	const { docsContracts, graphsDir } = fixtureDir();
	const registryPath = join(docsContracts, "benchmark-job-id-registry.json");
	writeFileSync(
		registryPath,
		JSON.stringify({
			schema_version: "benchmark_job_id_registry/v1",
			job_ids: [
				{ job_id: "known.id", graph_id: "wave_issue_execute", node_ids: ["build"], handler_type: "coder" },
			],
		}),
	);
	writeFileSync(
		join(graphsDir, "wave_issue_execute.dot"),
		'digraph t { build [class="coder" benchmark_job_id="fake.unregistered.id"]; }\n',
	);

	const run = spawnSync("node", [
		scriptPath,
		"--registry",
		registryPath,
		"--graphs-dir",
		graphsDir,
	], { encoding: "utf8" });

	assert.equal(run.status, 1);
	assert.match(run.stderr, /violation=unknown_graph_job_id/);
	assert.match(run.stderr, /result=fail/);
});
