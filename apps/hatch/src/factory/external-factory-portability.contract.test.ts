import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runFactoryConformanceHarness } from "./conformance-harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO_ROOT = path.resolve(__dirname, "../../../../");

describe("external-factory portability contract", () => {
	it("passes skill_loading for mothership", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "factories/mothership"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["config_schema", "skill_loading"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});

	it("passes skill_loading for external-factory fixture", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "examples/external-factories/acme-support"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["config_schema", "skill_loading"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});

	it("passes scenario_root for mothership", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "factories/mothership"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["config_schema", "scenario_root"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});

	it("passes scenario_root for external-factory fixture", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "examples/external-factories/acme-support"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["config_schema", "scenario_root"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});

	it("passes config_schema, skill_loading, scenario_root, and run_dir_isolation for acme-support with synthetic repoRoot", async () => {
		const acmeSupportRoot = path.join(REAL_REPO_ROOT, "examples/external-factories/acme-support");
		const result = await runFactoryConformanceHarness({
			factoryRoot: acmeSupportRoot,
			repoRoot: acmeSupportRoot,
			runsDir: "../.hatch/acme-support/runs",
			phases: ["config_schema", "skill_loading", "scenario_root", "run_dir_isolation"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
		for (const phase of result.phases) {
			expect(phase.ok).toBe(true);
		}
	});

	it("passes config_schema, skill_loading, and scenario_root for example-trading", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "factories/example-trading"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["config_schema", "skill_loading", "scenario_root"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});

	it("passes config_schema, skill_loading, and scenario_root for brainstorm", async () => {
		const result = await runFactoryConformanceHarness({
			factoryRoot: path.join(REAL_REPO_ROOT, "factories/brainstorm"),
			repoRoot: REAL_REPO_ROOT,
			phases: ["config_schema", "skill_loading", "scenario_root"],
		});
		expect(result.ok).toBe(true);
		expect(result.failed_phase).toBe("");
	});
});
