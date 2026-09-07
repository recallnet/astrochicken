import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSharedToolEnv } from "./tool-env.js";

describe("createSharedToolEnv", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0, roots.length)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("sets FACTORY_REPO, FACTORY_CONFIG_PATH, HATCH_PIPELINE_FILE, and HATCH_WORKDIR", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-tool-env-"));
		roots.push(root);
		const pipelineFile = join(root, "factories", "mothership", "graphs", "factory_supervisor_tick.dot");
		const configPath = join(root, "factory.config.json");
		writeFileSync(configPath, "{}\n");

		const env = createSharedToolEnv({
			pipelineFile,
			workDir: ".",
			repoRootResolver: () => root,
			pathExists: () => true,
		});

		expect(env.FACTORY_REPO).toBe(root);
		expect(env.FACTORY_CONFIG_PATH).toBe(configPath);
		expect(env.HATCH_PIPELINE_FILE).toBe(pipelineFile);
		expect(env.HATCH_WORKDIR).toBe(process.cwd());
	});

	it("emits empty FACTORY_CONFIG_PATH when config file is absent", () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-tool-env-missing-config-"));
		roots.push(root);
		const pipelineFile = join(root, "pipelines", "sample.dot");

		const env = createSharedToolEnv({
			pipelineFile,
			workDir: root,
			repoRootResolver: () => root,
			pathExists: () => false,
		});

		expect(env.FACTORY_CONFIG_PATH).toBe("");
		expect(env.HATCH_WORKDIR).toBe(root);
	});
});
