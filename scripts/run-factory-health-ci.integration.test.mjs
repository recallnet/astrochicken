import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test, { before, after } from "node:test";
import { createCanonicalEventStoreFixture } from "../packages/factory-ops/test/supervisor/factory-status-postgres-fixture.ts";
import { fileURLToPath } from "node:url";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";
import { runFactoryHealthCi } from "./run-factory-health-ci.mjs";

// Test operator visibility against a disposable store, never the host's live database.
const postgresFixture = createCanonicalEventStoreFixture();
const previousEventStoreUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
before(async () => {
	await postgresFixture.setup();
	process.env.HATCH_CANONICAL_EVENT_STORE_URL = postgresFixture.connectionString;
});
after(() => {
	if (previousEventStoreUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
	else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousEventStoreUrl;
	postgresFixture.teardown();
});

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const cliPath = join(repoRoot, "scripts", "run-factory-health-ci.mjs");
const expectedFactoryIds = JSON.parse(readFileSync(join(repoRoot, "factory-registry.json"), "utf8")).instances.map((entry) => entry.instance_id).sort();
test("runFactoryHealthCi reports checked-in factory health in strict mode when all factories are healthy", async () => {
	ensureHatchBuild({ repoRoot });
	const result = await runFactoryHealthCi({ strict: true });

	assert.equal(result.exitStatus, 0);
	assert.equal(result.summary.mode, "strict");
	assert.equal(result.summary.total, expectedFactoryIds.length);
	assert.deepEqual(
		result.summary.factories.map((entry) => entry.factory_id),
		expectedFactoryIds,
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
	assert.match(run.stderr, /factory_health_ci action=start total=5 mode=strict/);
	assert.match(run.stderr, /factory_health_ci factory=brainstorm result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=example-scanner result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=mothership result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=example-web result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci factory=example-trading result=ok failed_phase=/);
	assert.match(run.stderr, /factory_health_ci result=ok total=5 failed=0 mode=strict/);

	const payload = JSON.parse(run.stdout);
	assert.equal(payload.mode, "strict");
	assert.equal(payload.total, expectedFactoryIds.length);
	assert.equal(payload.failed, 0);
});

test("factory-health-ci CLI stays green in strict mode when checked-in factories are healthy", () => {
	ensureHatchBuild({ repoRoot });
	const run = spawnSync("node", [cliPath, "--strict"], {
		cwd: repoRoot,
		encoding: "utf8",
	});

	assert.equal(run.status, 0, run.stderr || run.stdout);
	assert.match(run.stderr, /factory_health_ci result=ok total=5 failed=0 mode=strict/);
});
