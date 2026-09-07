#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_REGISTRY_PATH = join(REPO_ROOT, "docs", "contracts", "benchmark-job-id-registry.json");
const DEFAULT_GRAPHS_DIR = join(REPO_ROOT, "factories", "mothership", "graphs");
const BENCHMARK_JOB_ID_RE = /benchmark_job_id\s*=\s*"([^"]+)"/g;

function parseArgs(argv) {
	const options = {
		json: false,
		registryPath: DEFAULT_REGISTRY_PATH,
		graphsDir: DEFAULT_GRAPHS_DIR,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--registry") {
			const value = argv[index + 1];
			if (!value) throw new Error("--registry requires a path");
			options.registryPath = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--graphs-dir") {
			const value = argv[index + 1];
			if (!value) throw new Error("--graphs-dir requires a path");
			options.graphsDir = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function usage() {
	return "Usage: node scripts/check-benchmark-job-id-registry.ts [--json] [--registry <path>] [--graphs-dir <path>]";
}

function loadRegistry(registryPath) {
	const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
	const entries = Array.isArray(parsed?.job_ids) ? parsed.job_ids : [];
	const counts = new Map();
	for (const entry of entries) {
		const jobId = String(entry?.job_id || "").trim();
		if (!jobId) continue;
		counts.set(jobId, (counts.get(jobId) || 0) + 1);
	}
	const duplicates = [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([job_id, count]) => ({ job_id, count }))
		.sort((a, b) => a.job_id.localeCompare(b.job_id, "en"));
	return {
		jobIdSet: new Set(counts.keys()),
		jobIdCount: counts.size,
		duplicates,
	};
}

function listGraphFiles(graphsDir) {
	return readdirSync(graphsDir)
		.filter((file) => file.endsWith(".dot"))
		.sort((a, b) => a.localeCompare(b, "en"));
}

function scanGraphBenchmarkJobIds(graphFiles, registryJobIds, graphsDir) {
	const missing = [];
	let checked = 0;

	for (const graphFile of graphFiles) {
		const fullPath = join(graphsDir, graphFile);
		const body = readFileSync(fullPath, "utf8");
		for (const match of body.matchAll(BENCHMARK_JOB_ID_RE)) {
			const benchmarkJobId = String(match[1] || "").trim();
			if (!benchmarkJobId) continue;
			checked += 1;
			if (!registryJobIds.has(benchmarkJobId)) {
				missing.push({
					file: `factories/mothership/graphs/${graphFile}`,
					job_id: benchmarkJobId,
				});
			}
		}
	}

	missing.sort((a, b) => {
		const byFile = a.file.localeCompare(b.file, "en");
		if (byFile !== 0) return byFile;
		return a.job_id.localeCompare(b.job_id, "en");
	});

	return { checked, missing };
}

export function runBenchmarkJobIdRegistryCheck(options = {}) {
	const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
	const graphsDir = options.graphsDir || DEFAULT_GRAPHS_DIR;
	const { jobIdSet, jobIdCount, duplicates } = loadRegistry(registryPath);
	const graphFiles = listGraphFiles(graphsDir);
	const { checked, missing } = scanGraphBenchmarkJobIds(graphFiles, jobIdSet, graphsDir);
	const violations = [
		...duplicates.map((entry) => ({ code: "duplicate_job_id", ...entry })),
		...missing.map((entry) => ({ code: "unknown_graph_job_id", ...entry })),
	];
	return {
		ok: violations.length === 0,
		checked,
		job_ids: jobIdCount,
		graph_files: graphFiles.length,
		violations,
	};
}

function printTextResult(result) {
	if (!result.ok) {
		for (const violation of result.violations) {
			if (violation.code === "duplicate_job_id") {
				process.stderr.write(
					`[benchmark-job-id-registry] violation=duplicate_job_id job_id=${JSON.stringify(violation.job_id)} count=${violation.count}\n`,
				);
				continue;
			}
			process.stderr.write(
				`[benchmark-job-id-registry] violation=unknown_graph_job_id file=${JSON.stringify(violation.file)} job_id=${JSON.stringify(violation.job_id)}\n`,
			);
		}
		process.stderr.write(
			`[benchmark-job-id-registry] result=fail checked=${result.checked} job_ids=${result.job_ids} violations=${result.violations.length}\n`,
		);
		return;
	}

	process.stdout.write(
		`[benchmark-job-id-registry] result=ok checked=${result.checked} job_ids=${result.job_ids}\n`,
	);
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	const result = runBenchmarkJobIdRegistryCheck({
		registryPath: options.registryPath,
		graphsDir: options.graphsDir,
	});
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} else {
		printTextResult(result);
	}
	if (!result.ok) {
		process.exit(1);
	}
}

const isEntryPoint = process.argv[1]
	? import.meta.url === pathToFileURL(process.argv[1]).href
	: false;

if (isEntryPoint) {
	try {
		main();
	} catch (error) {
		console.error(error?.message || error);
		process.exit(1);
	}
}
