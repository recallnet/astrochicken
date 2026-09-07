import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadScenarios } from "./scenarios.js";

function writeScenario(registryRoot: string, relativeDir: string, body = "Scenario context."): void {
	const scenarioDir = join(registryRoot, relativeDir);
	mkdirSync(scenarioDir, { recursive: true });
	writeFileSync(
		join(scenarioDir, "SCENARIO.md"),
		`---\nid: test-scenario\ntitle: Test Scenario\npriority: high\nscope: astrochicken\ndomain: issue-triage\ntags: [factory]\n---\n\n## Context\n${body}\n`,
		"utf8",
	);
}

describe("loadScenarios", () => {
	it("loads scenarios relative to the provided registry root", () => {
		const registryRoot = mkdtempSync(join(tmpdir(), "hatch-scenarios-root-"));
		writeScenario(registryRoot, "astrochicken/issue-triage/test-scenario");

		const output = loadScenarios("astrochicken", registryRoot);

		expect(output).toContain("Test Scenario");
		expect(output).toContain("issue-triage");
		expect(output).toContain(registryRoot);
	});

	it("fails closed when registry root is missing", () => {
		expect(() => loadScenarios("astrochicken", "")).toThrow(/scenario registry root is required/);
	});
});
