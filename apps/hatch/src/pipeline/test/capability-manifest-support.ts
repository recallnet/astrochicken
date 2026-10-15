import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { expect, it } from "vitest";

export interface CapabilityManifestContract {
	entrypoints: { kind: string; path: string }[];
	skillPaths: string[];
	requiredContextKeys: string[];
	requiredRoles: string[];
	requiredHandlers: string[];
}

/** Shared filesystem contract; each capability still registers its own cases. */
export function createCapabilityManifestFixture<T extends CapabilityManifestContract = CapabilityManifestContract>(
	capabilityRoot: string,
) {
	function loadContract(): T {
		return JSON.parse(readFileSync(join(capabilityRoot, "capability-manifest.v1.json"), "utf8")) as T;
	}

	function declaredGraphs(contract: CapabilityManifestContract): string[] {
		return contract.entrypoints.filter((entrypoint) => entrypoint.kind === "graph").map((entrypoint) => entrypoint.path);
	}

	function collectWorkflowSources(dir: string): string[] {
		const files: string[] = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) files.push(...collectWorkflowSources(fullPath));
			else if (entry.isFile() && entry.name.endsWith(".workflow-source.mjs")) {
				files.push(relative(capabilityRoot, fullPath).replaceAll("\\", "/"));
			}
		}
		return files.sort();
	}

	function registerFilesystemContract({ checkSkills = true } = {}) {
		it("every declared graph path exists on disk", () => {
			for (const graphPath of declaredGraphs(loadContract())) {
				expect(existsSync(join(capabilityRoot, graphPath)), `declared graph missing: ${graphPath}`).toBe(true);
			}
		});
		if (checkSkills) {
			it("every declared skill path exists on disk", () => {
				for (const skillPath of loadContract().skillPaths) {
					expect(existsSync(join(capabilityRoot, skillPath)), `declared skill missing: ${skillPath}`).toBe(true);
				}
			});
		}
		it("has no undeclared workflow source modules in workflows/", () => {
			const contract = loadContract();
			const sources = collectWorkflowSources(join(capabilityRoot, "workflows"));
			expect(sources.length).toBeGreaterThan(0);
			for (const source of sources) expect(declaredGraphs(contract)).toContain(source);
		});
	}

	return { loadContract, declaredGraphs, registerFilesystemContract };
}
