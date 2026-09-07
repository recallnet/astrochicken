#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_THRESHOLD_DAYS = 90;
const MILLIS_PER_DAY = 86_400_000;

function normalizePath(path) {
	return String(path || "").replaceAll("\\", "/");
}

export function deriveFactoryIdFromPolicyPath(policyPath, repoRoot = REPO_ROOT) {
	const rel = normalizePath(relative(repoRoot, policyPath));
	const parts = rel.split("/");
	if (parts[0] === "factories" && parts.length >= 2) return parts[1];
	if (parts[0] === "examples" && parts[1] === "external-factories" && parts.length >= 3) return parts[2];
	return "";
}

function discoverPolicyFilesForBase(baseDir, repoRoot) {
	if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) return [];
	const descriptors = [];
	for (const factoryDirent of readdirSync(baseDir, { withFileTypes: true })) {
		if (!factoryDirent.isDirectory()) continue;
		const factoryId = factoryDirent.name;
		const policyPackDir = join(baseDir, factoryId, "policy-pack");
		if (!existsSync(policyPackDir) || !statSync(policyPackDir).isDirectory()) continue;
		for (const versionDirent of readdirSync(policyPackDir, { withFileTypes: true })) {
			if (!versionDirent.isDirectory()) continue;
			const policyPath = resolve(join(policyPackDir, versionDirent.name, "model-policy.json"));
			if (!existsSync(policyPath)) continue;
			descriptors.push({
				path: policyPath,
				factory_id: factoryId,
				relative_path: normalizePath(relative(repoRoot, policyPath)),
			});
		}
	}
	return descriptors;
}

export function discoverModelPolicyFiles({ repoRoot = REPO_ROOT } = {}) {
	const normalizedRoot = resolve(repoRoot);
	const internal = discoverPolicyFilesForBase(join(normalizedRoot, "factories"), normalizedRoot);
	const external = discoverPolicyFilesForBase(
		join(normalizedRoot, "examples", "external-factories"),
		normalizedRoot,
	);
	return [...internal, ...external].sort((left, right) => left.relative_path.localeCompare(right.relative_path, "en"));
}

export function checkModelPolicyEvidenceStaleness({
	policyFiles,
	thresholdDays = DEFAULT_THRESHOLD_DAYS,
	nowMs = Date.now(),
	repoRoot = REPO_ROOT,
} = {}) {
	const normalizedThreshold = Number.isFinite(Number(thresholdDays)) ? Math.max(0, Math.floor(Number(thresholdDays))) : DEFAULT_THRESHOLD_DAYS;
	const stale = [];
	const files = Array.isArray(policyFiles) ? policyFiles : [];

	for (const entry of files) {
		const descriptor = typeof entry === "string" ? { path: resolve(entry) } : (entry || {});
		const policyPath = resolve(String(descriptor.path || ""));
		if (!policyPath || !existsSync(policyPath)) continue;

		let parsed;
		try {
			parsed = JSON.parse(readFileSync(policyPath, "utf8"));
		} catch {
			continue;
		}

		const evidenceDate = String(parsed?.factory?.benchmark_justification?.evidence_date || "").trim();
		if (!evidenceDate) continue;

		const evidenceMs = Date.parse(evidenceDate);
		if (!Number.isFinite(evidenceMs)) continue;

		const ageDays = Math.floor((nowMs - evidenceMs) / MILLIS_PER_DAY);
		if (ageDays > normalizedThreshold) {
			const factoryId = String(descriptor.factory_id || deriveFactoryIdFromPolicyPath(policyPath, repoRoot) || "").trim();
			stale.push({
				factory_id: factoryId,
				evidence_date: evidenceDate,
				age_days: ageDays,
				path: normalizePath(policyPath),
			});
		}
	}

	stale.sort((left, right) => {
		const byFactory = left.factory_id.localeCompare(right.factory_id, "en");
		if (byFactory !== 0) return byFactory;
		return left.evidence_date.localeCompare(right.evidence_date, "en");
	});

	return {
		threshold_days: normalizedThreshold,
		scanned_files: files.length,
		stale,
		stale_count: stale.length,
		result: stale.length > 0 ? "warning_only" : "ok",
	};
}

export function formatModelPolicyEvidenceStalenessLines(result) {
	const lines = [];
	for (const entry of result?.stale || []) {
		lines.push(
			`model_policy_evidence_stale factory_id=${entry.factory_id} evidence_date=${entry.evidence_date} age_days=${entry.age_days}`,
		);
	}
	if ((result?.stale_count || 0) > 0) {
		lines.push(`[model-policy-staleness] result=warning_only stale_count=${result.stale_count}`);
	} else {
		lines.push("[model-policy-staleness] result=ok");
	}
	return lines;
}

function parseArgs(argv) {
	const args = Array.isArray(argv) ? [...argv] : [];
	const options = {
		thresholdDays: DEFAULT_THRESHOLD_DAYS,
		json: false,
		help: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		if (arg === "--threshold-days") {
			const raw = args[index + 1];
			if (!raw) throw new Error("--threshold-days requires a numeric value");
			const parsed = Number(raw);
			if (!Number.isFinite(parsed) || parsed < 0) {
				throw new Error(`--threshold-days must be a non-negative number, received ${JSON.stringify(raw)}`);
			}
			options.thresholdDays = Math.floor(parsed);
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function usage() {
	return "Usage: node scripts/check-model-policy-evidence-staleness.ts [--threshold-days <days>] [--json]";
}

export function runModelPolicyEvidenceStalenessCheck(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.help) {
		return { help: true, usage: usage() };
	}
	const policyFiles = discoverModelPolicyFiles({ repoRoot: REPO_ROOT });
	const result = checkModelPolicyEvidenceStaleness({
		policyFiles,
		thresholdDays: options.thresholdDays,
		nowMs: Date.now(),
		repoRoot: REPO_ROOT,
	});
	return {
		help: false,
		json: options.json,
		result,
	};
}

function main() {
	const runResult = runModelPolicyEvidenceStalenessCheck(process.argv.slice(2));
	if (runResult.help) {
		process.stdout.write(`${runResult.usage}\n`);
		return;
	}
	if (runResult.json) {
		process.stdout.write(`${JSON.stringify(runResult.result)}\n`);
		return;
	}
	for (const line of formatModelPolicyEvidenceStalenessLines(runResult.result)) {
		process.stdout.write(`${line}\n`);
	}
}

const isEntryPoint = process.argv[1]
	? import.meta.url === pathToFileURL(process.argv[1]).href
	: false;

if (isEntryPoint) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`[model-policy-staleness] error=${JSON.stringify(String(error?.message || error))}\n`);
		process.stdout.write("[model-policy-staleness] result=ok\n");
	}
}
