import { describe, expect, it } from "vitest";

import { parseFactoryContextOverrideArgs } from "./factory-context-overrides.js";

describe("factory context override arg parser", () => {
	it("extracts factory-context flags and preserves command args", () => {
		const parsed = parseFactoryContextOverrideArgs([
			"--factory-root",
			"/tmp/factory",
			"--factory-config-path=/tmp/factory/factory.config.json",
			"--factory-id",
			"mothership",
			"--target-repo",
			"recallnet/astrochicken",
			"--control-plane-repo=recallnet/astrochicken",
			"--runs-dir",
			"/tmp/runs",
			"--scenarios-root=/tmp/scenarios",
			"--factory-mode",
			"managed",
			"run",
			"pipeline.dot",
		]);

		expect(parsed.flags).toEqual({
			factoryRoot: "/tmp/factory",
			factoryConfigPath: "/tmp/factory/factory.config.json",
			factoryId: "mothership",
			targetRepo: "recallnet/astrochicken",
			controlPlaneRepo: "recallnet/astrochicken",
			runsDir: "/tmp/runs",
			scenariosRoot: "/tmp/scenarios",
			factoryMode: "managed",
		});
		expect(parsed.args).toEqual(["run", "pipeline.dot"]);
	});

	it("supports --config-path alias and leaves --repo untouched by default", () => {
		const parsed = parseFactoryContextOverrideArgs([
			"--repo",
			"/tmp/repo-path",
			"--config-path",
			"/tmp/factory.config.json",
			"recovery-sweep",
		]);

		expect(parsed.flags.targetRepo).toBe("");
		expect(parsed.flags.factoryConfigPath).toBe("/tmp/factory.config.json");
		expect(parsed.flags.factoryMode).toBe("");
		expect(parsed.args).toEqual(["--repo", "/tmp/repo-path", "recovery-sweep"]);
	});

	it("supports optional --repo alias when explicitly enabled", () => {
		const parsed = parseFactoryContextOverrideArgs([
			"--repo",
			"acme/support",
			"run",
			"pipeline.dot",
		], { repoAlias: true });

		expect(parsed.flags.targetRepo).toBe("acme/support");
		expect(parsed.flags.factoryMode).toBe("");
		expect(parsed.args).toEqual(["run", "pipeline.dot"]);
	});

	it("parses --factory-mode inline and positional value", () => {
		const inline = parseFactoryContextOverrideArgs([
			"--factory-mode=standalone",
			"runs",
		]);
		expect(inline.flags.factoryMode).toBe("standalone");
		expect(inline.args).toEqual(["runs"]);

		const positional = parseFactoryContextOverrideArgs([
			"--factory-mode",
			"managed",
			"run",
			"pipeline.dot",
		]);
		expect(positional.flags.factoryMode).toBe("managed");
		expect(positional.args).toEqual(["run", "pipeline.dot"]);
	});
});
