#!/usr/bin/env node
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const factoriesRoot = join(repoRoot, "factories");
const healthCheckModuleUrl = pathToFileURL(join(scriptsDir, "factory-health-check.mjs")).href;
const CI_SAFE_CONFORMANCE_PHASES = [
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
];

function usage() {
	return [
		"Usage:",
		"  node scripts/run-factory-health-ci.mjs [--strict] [--json]",
	].join("\n");
}

function parseArgs(argv) {
	const options = {
		strict: false,
		json: false,
		help: false,
	};

	for (const arg of argv) {
		if (arg === "--strict") {
			options.strict = true;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
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

function listCheckedInFactoryRoots(root = factoriesRoot) {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
		.map((entry) => join(root, entry.name))
		.filter((candidate) => {
			try {
				return readdirSync(candidate).includes("factory.config.json");
			} catch {
				return false;
			}
		})
		.sort((left, right) => left.localeCompare(right, "en"));
}

function toFactoryId(factoryRoot) {
	return factoryRoot.split("/").at(-1) || factoryRoot;
}

function formatSummaryLine(result) {
	return [
		"factory_health_ci",
		`factory=${result.factory_id}`,
		`result=${result.ok ? "ok" : "fail"}`,
		`failed_phase=${result.failed_phase || ""}`,
	].join(" ");
}

function writeStepSummary(results, options) {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryPath) return;

	const failing = results.filter((result) => !result.ok);
	const mode = options.strict ? "strict" : "warn_only";
	const lines = [
		"## Factory Health",
		"",
		`Mode: \`${mode}\``,
		"",
		"| Factory | Result | Failed phase |",
		"| --- | --- | --- |",
		...results.map((result) => `| ${result.factory_id} | ${result.ok ? "ok" : "fail"} | ${result.failed_phase || ""} |`),
	];
	if (failing.length > 0) {
		lines.push("", `Failures: ${failing.map((result) => `\`${result.factory_id}\``).join(", ")}`);
	}
	writeFileSync(summaryPath, `${lines.join("\n")}\n`, { flag: "a" });
}

export async function runFactoryHealthCi(options = {}) {
	const { runFactoryHealthCheck } = await import(healthCheckModuleUrl);
	const strict = Boolean(options.strict);
	const factoryRoots = listCheckedInFactoryRoots();
	const results = [];

	process.stderr.write(
		`factory_health_ci action=start total=${factoryRoots.length} mode=${strict ? "strict" : "warn_only"} profile=ci_safe\n`,
	);

	for (const factoryRoot of factoryRoots) {
		const health = await runFactoryHealthCheck({
			factoryRoot,
			repoRoot,
			skipBuild: true,
			phases: CI_SAFE_CONFORMANCE_PHASES,
			dotLintStrictWarnings: strict,
		});
		const result = {
			factory_id: toFactoryId(factoryRoot),
			factory_root: factoryRoot,
			ok: Boolean(health.ok),
			failed_phase: String(health.failedPhase || ""),
			exit_status: Number.isInteger(health.exitStatus) ? health.exitStatus : health.ok ? 0 : 1,
			error: String(health.error || ""),
		};
		results.push(result);
		process.stderr.write(`${formatSummaryLine(result)}\n`);
	}

	const failed = results.filter((result) => !result.ok);
	const ok = failed.length === 0;
	const exitStatus = strict && !ok ? 1 : 0;
	const summary = {
		ok,
		mode: strict ? "strict" : "warn_only",
		total: results.length,
		failed: failed.length,
		factories: results,
	};

	process.stderr.write(
		`factory_health_ci result=${ok ? "ok" : strict ? "fail" : "warning_only"} total=${results.length} failed=${failed.length} mode=${summary.mode}\n`,
	);
	writeStepSummary(results, { strict });
	return { exitStatus, summary };
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`factory_health_ci action=parse_args result=fail error=${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`);
		process.exit(1);
		return;
	}

	if (options.help) {
		process.stdout.write(`${usage()}\n`);
		return;
	}

	const { exitStatus, summary } = await runFactoryHealthCi(options);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	}
	if (exitStatus !== 0) {
		process.exit(exitStatus);
	}
}

const isEntryPoint = process.argv[1]
	? import.meta.url === pathToFileURL(process.argv[1]).href
	: false;

if (isEntryPoint) {
	main().catch((error) => {
		process.stderr.write(`factory_health_ci action=run result=fail error=${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`);
		process.exit(1);
	});
}
