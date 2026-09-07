import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { buildTickEnv } from "../../../../packages/factory-ops/src/lib/daemon-llm-isolation.ts";
import { resolveFactoryContext as resolveSharedFactoryContext } from "./context-resolver.js";

vi.mock("../../../../packages/factory-ops/src/lib/factory-context-resolver.ts", () => ({
	resolveFactoryContext: resolveSharedFactoryContext,
}));

import { resolveTickRuntime } from "../../../../packages/factory-ops/src/lib/daemon.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const registry = JSON.parse(readFileSync(path.join(repoRoot, "factory-registry.json"), "utf8"));
const hostileMothershipEnv = Object.freeze({
	HATCH_TARGET_REPO: "recallnet/astrochicken",
	HATCH_FACTORY_ROOT: "factories/mothership",
	HATCH_FACTORY_ID: "mothership",
	HATCH_INSTANCE_ID: "mothership",
	HATCH_KIND_ID: "mothership",
	MOTHERSHIP_REPO: "recallnet/astrochicken",
});
const originalCwd = process.cwd();

function buildDummyPaths(factoryId: string) {
	return {
		hostRoot: `/tmp/${factoryId}/host`,
		logsDir: `/tmp/${factoryId}/logs`,
		pidDir: `/tmp/${factoryId}/pid`,
		pidFile: `/tmp/${factoryId}/pid/factory-daemon.pid`,
		lockDir: `/tmp/${factoryId}/locks`,
		tmpDir: `/tmp/${factoryId}/tmp`,
		socketDir: `/tmp/${factoryId}/socket`,
	};
}

describe("daemon startup identity contract", () => {
	for (const entry of registry.instances as Array<Record<string, unknown>>) {
		const factoryId = String(entry.instance_id || "").trim();
		if (!factoryId) continue;

		it(`${factoryId} tick env round-trips through the shared context resolver`, () => {
			process.chdir(repoRoot);
			try {
				const runtime = resolveTickRuntime({ factoryId, repoRoot });
				const tickEnv = buildTickEnv({
					runtime,
					paths: buildDummyPaths(factoryId),
					hostBaseDir: `/tmp/${factoryId}/host-base`,
					processEnv: hostileMothershipEnv,
				});

				const resolved = resolveSharedFactoryContext({
					cwd: repoRoot,
					factoryRoot: runtime.factoryRoot,
					requireTargetRepo: true,
					processEnv: tickEnv,
				});

				expect(resolved.factory_id).toBe(runtime.factoryId);
				expect(resolved.factory_root.endsWith(runtime.factoryRoot)).toBe(true);
				expect(resolved.target_repo).toBe(runtime.targetRepo);
				expect(resolved.target_repo).toBe(runtime.targetRepo);
				expect(resolved.control_plane_repo).toBe(runtime.controlPlaneRepo);
				expect(resolved.instance_id).toBe(runtime.factoryId);
				expect(resolved.runs_dir).toBe(runtime.runsDir);
			} finally {
				process.chdir(originalCwd);
			}
		});
	}
});
