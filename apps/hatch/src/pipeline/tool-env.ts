import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { findRepoRoot } from "../intent/loader.js";

export interface SharedToolEnvOptions {
	pipelineFile: string;
	workDir: string;
	repoRootResolver?: (startDir: string) => string;
	pathExists?: (path: string) => boolean;
}

/**
 * Build deterministic shared tool environment for a pipeline run.
 *
 * Keys are always present so tool handlers can rely on stable contracts.
 */
export function createSharedToolEnv(options: SharedToolEnvOptions): Record<string, string> {
	const pipelineFile = resolve(options.pipelineFile);
	const repoRoot = (options.repoRootResolver ?? findRepoRoot)(dirname(pipelineFile));
	const factoryConfigPathCandidate = join(repoRoot, "factory.config.json");
	const factoryConfigPath = (options.pathExists ?? existsSync)(factoryConfigPathCandidate)
		? factoryConfigPathCandidate
		: "";
	const resolvedWorkDir = resolve(options.workDir || ".");

	return {
		FACTORY_REPO: repoRoot,
		FACTORY_CONFIG_PATH: factoryConfigPath,
		HATCH_PIPELINE_FILE: pipelineFile,
		HATCH_WORKDIR: resolvedWorkDir,
	};
}
