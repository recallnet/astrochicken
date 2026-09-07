import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	formatIntentStackCommandHint,
	runIntentStackPhase,
	runScenarioRootPhase,
	runSkillLoadingPhase,
	type RuntimeInputCommandRunner,
} from "./conformance-runtime-inputs.js";

import type { FactoryConfigDocument } from "./config-schema.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function createFactoryConfig(repoRoot: string): FactoryConfigDocument {
	return {
		$id: "https://recallnet.dev/schemas/factory.config.v1.json",
		name: "fixture-factory",
		repo: "recallnet/astrochicken",
		skills: {
			supervisor: "skills/supervisor/current.md",
		},
		scenarios: {
			root: "scenarios/fixture-factory",
		},
		labels: {
			root: "factory:fixture-factory",
		},
		modes: {
			default: "supervisor",
		},
	};
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("conformance-runtime-inputs", () => {
	it("formats and runs the intent stack phase through hatch-ops", () => {
		const commandCwd = createTempDir("conformance-runtime-inputs-cwd-");
		const factoryRoot = path.join(commandCwd, "factories", "fixture-factory");
		mkdirSync(factoryRoot, { recursive: true });

		const runCommand: RuntimeInputCommandRunner = (request) => ({
			ok: true,
			command: [request.command, ...request.args].join(" "),
			stdout: JSON.stringify({
				factory_id: "fixture-factory",
				target_repo: "recallnet/astrochicken",
				platform_intent_path: path.join(commandCwd, "docs/astrochicken/astrochicken-platform-intent.md"),
				factory_intent_path: path.join(factoryRoot, "INTENT.md"),
			}),
			stderr: "",
			exitCode: 0,
			timedOut: false,
			errorMessage: "",
		});

		const hint = formatIntentStackCommandHint({ commandCwd, factoryRoot });
		expect(hint).toContain("hatch-ops common resolve-intent-stack");
		expect(hint).toContain(factoryRoot);

		const result = runIntentStackPhase({
			factoryRoot,
			commandCwd,
			timeoutMs: 10_000,
			runCommand,
		});

		expect(result.command).toContain("hatch-ops common resolve-intent-stack");
		expect(result.details).toMatchObject({
			factory_root: factoryRoot,
			factory_id: "fixture-factory",
			target_repo: "recallnet/astrochicken",
		});
	});

	it("validates skill and scenario runtime inputs from factory config", () => {
		const repoRoot = createTempDir("conformance-runtime-inputs-repo-");
		const skillPath = path.join(repoRoot, "skills", "supervisor");
		const scenarioPath = path.join(repoRoot, "scenarios", "fixture-factory");
		mkdirSync(skillPath, { recursive: true });
		mkdirSync(scenarioPath, { recursive: true });
		writeFileSync(path.join(skillPath, "current.md"), "# supervisor\n");
		const config = createFactoryConfig(repoRoot);

		expect(runSkillLoadingPhase(config, repoRoot).details).toMatchObject({
			skill_path: "skills/supervisor/current.md",
		});
		expect(runScenarioRootPhase(config, repoRoot).details).toMatchObject({
			scenarios_root: "scenarios/fixture-factory",
		});
	});

	it("resolves runtime inputs from factory root before repo root when provided", () => {
		const repoRoot = createTempDir("conformance-runtime-inputs-repo-first-");
		const factoryRoot = path.join(repoRoot, "examples", "external-factory");
		mkdirSync(path.join(factoryRoot, "skills", "supervisor"), { recursive: true });
		mkdirSync(path.join(factoryRoot, "scenarios", "fixture-factory"), { recursive: true });
		writeFileSync(path.join(factoryRoot, "skills", "supervisor", "current.md"), "# supervisor\n");
		const config = createFactoryConfig(repoRoot);

		expect(runSkillLoadingPhase(config, repoRoot, factoryRoot).details).toMatchObject({
			skill_path: "skills/supervisor/current.md",
			resolved_path: path.join(factoryRoot, "skills", "supervisor", "current.md"),
		});
		expect(runScenarioRootPhase(config, repoRoot, factoryRoot).details).toMatchObject({
			scenarios_root: "scenarios/fixture-factory",
			resolved_path: path.join(factoryRoot, "scenarios", "fixture-factory"),
		});
	});

	it("throws structured errors when runtime inputs are missing", () => {
		const repoRoot = createTempDir("conformance-runtime-inputs-missing-");
		const config = createFactoryConfig(repoRoot);

		expect(() => runSkillLoadingPhase(config, repoRoot)).toThrow(/skills\.supervisor/);
		expect(() => runScenarioRootPhase(config, repoRoot)).toThrow(/scenarios\.root/);
	});
});
