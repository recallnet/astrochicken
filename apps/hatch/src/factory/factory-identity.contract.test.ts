import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveFactoryContext } from "./context-resolver.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const registry = JSON.parse(readFileSync(path.join(repoRoot, "factory-registry.json"), "utf8"));
function readFactoryConfig(factoryId: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path.join(repoRoot, "factories", factoryId, "factory.config.json"), "utf8"));
}
const hostileMothershipEnv = Object.freeze({
	HATCH_TARGET_REPO: "recallnet/astrochicken",
	HATCH_FACTORY_ROOT: "factories/mothership",
	HATCH_FACTORY_ID: "mothership",
	HATCH_INSTANCE_ID: "mothership",
	HATCH_KIND_ID: "mothership",
	MOTHERSHIP_REPO: "recallnet/astrochicken",
	HATCH_CONTROL_PLANE_REPO: "recallnet/astrochicken",
});

describe("registered factory identity contracts", () => {
	it("brainstorm config wins over inherited mothership env", () => {
		const context = resolveFactoryContext({
			cwd: repoRoot,
			factoryRoot: "factories/brainstorm",
			requireTargetRepo: true,
			processEnv: hostileMothershipEnv,
		});

		expect(context.factory_id).toBe("brainstorm");
		expect(context.target_repo).toBe("example-org/example-notes");
		expect(context.instance_id).toBe("brainstorm");
	});

	for (const entry of registry.instances as Array<Record<string, unknown>>) {
		const factoryId = String(entry.instance_id || "").trim();
		if (!factoryId) continue;
		const config = readFactoryConfig(factoryId);
		const expectedTargetRepo = String(config.target_repo || "").trim();
		if (!expectedTargetRepo) continue;

		it(`${factoryId} resolves to its registered target repo under hostile mothership env`, () => {
			const context = resolveFactoryContext({
				cwd: repoRoot,
				factoryRoot: `factories/${factoryId}`,
				requireTargetRepo: true,
				processEnv: hostileMothershipEnv,
			});

			expect(context.factory_id).toBe(factoryId);
			expect(context.target_repo).toBe(expectedTargetRepo);
			expect(context.factory_root.endsWith(`factories/${factoryId}`)).toBe(true);
		});
	}
});
