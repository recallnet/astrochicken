import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";
import { runFactoryHealthCi } from "./run-factory-health-ci.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliPath = join(repoRoot, "scripts", "run-factory-health-ci.mjs");
test("runFactoryHealthCi reports checked-in factory health in strict mode when all factories are healthy", async () => {
	ensureHatchBuild({ repoRoot });
	const result = await runFactoryHealthCi({ strict: true });

	assert.equal(result.exitStatus, 0);
	assert.equal(result.summary.mode, "strict");
	assert.equal(result.summary.total, 4);
	assert.deepEqual(
		result.summary.factories.map((entry) => entry.factory_id),
		["brainstorm", "mothership", "example-web", "example-trading"],
	);
	assert.equal(result.summary.factories.some((entry) => entry.ok === false), false);
});

test("factory-health-ci CLI emits strict summary and exits zero when all checked-in factories are healthy", () => {
	ensureHatchBuild({ repoRoot });
	const run = spawnSync("node", [cliPath, "--strict", "--json"], {
		cwd: repoRoot,
		encoding: "utf8",
	});

	assert.equal(run.status, 0, run.stderr || run.stdout);
	assert.match(run.stderr, /factory_health_ci action=start total=4 mode=strict/);
	assert.match(run.stderr, /factory_health_ci factory=brainstorm result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=mothership result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=example-web result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=example-trading result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci result=ok total=4 failed=0 mode=strict/);

	const payload = JSON.parse(run.stdout);
	assert.equal(payload.mode, "strict");
	assert.equal(payload.total, 4);
	assert.equal(payload.failed, 0);
});

test("factory-health-ci CLI stays green in strict mode when checked-in factories are healthy", () => {
	ensureHatchBuild({ repoRoot });
	const run = spawnSync("node", [cliPath, "--strict"], {
		cwd: repoRoot,
		encoding: "utf8",
	});

	assert.equal(run.status, 0, run.stderr || run.stdout);
	assert.match(run.stderr, /factory_health_ci result=ok total=4 failed=0 mode=strict/);
});
