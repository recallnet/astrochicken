import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface CapabilityContract {
	entrypoints: { kind: string; path: string }[];
	skillPaths: string[];
	requiredContextKeys: string[];
	requiredRoles: string[];
	requiredHandlers: string[];
}

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-release-reporting");
const CAPABILITY_CONTRACT_PATH = join(CAPABILITY_ROOT, "capability-manifest.v1.json");

function loadContract(): CapabilityContract {
	const raw = readFileSync(CAPABILITY_CONTRACT_PATH, "utf8");
	return JSON.parse(raw) as CapabilityContract;
}

function declaredGraphs(contract: CapabilityContract): string[] {
	return contract.entrypoints.filter((entrypoint) => entrypoint.kind === "graph").map((entrypoint) => entrypoint.path);
}

function collectDotFiles(dir: string): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectDotFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".dot")) {
			files.push(relative(CAPABILITY_ROOT, fullPath).replaceAll("\\", "/"));
		}
	}
	return files.sort();
}

describe("@hatch/capability-release-reporting manifest contract", () => {
	it("every declared graph path exists on disk", () => {
		const contract = loadContract();
		for (const graphPath of declaredGraphs(contract)) {
			const fullPath = join(CAPABILITY_ROOT, graphPath);
			expect(existsSync(fullPath), `declared graph missing: ${graphPath}`).toBe(true);
		}
	});

	it("every declared skill path exists on disk", () => {
		const contract = loadContract();
		for (const skillPath of contract.skillPaths) {
			const fullPath = join(CAPABILITY_ROOT, skillPath);
			expect(existsSync(fullPath), `declared skill missing: ${skillPath}`).toBe(true);
		}
	});

	it("has no undeclared .dot files in graphs/", () => {
		const contract = loadContract();
		const graphDotFiles = collectDotFiles(join(CAPABILITY_ROOT, "graphs"));
		expect(graphDotFiles.length).toBeGreaterThan(0);
		for (const dotPath of graphDotFiles) {
			expect(declaredGraphs(contract)).toContain(dotPath);
		}
	});

	it("requiredContextKeys includes gh_repo, release_reporting_repo, factory_id, trust_domain and trust_role", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("gh_repo");
		expect(contract.requiredContextKeys).toContain("release_reporting_repo");
		expect(contract.requiredContextKeys).toContain("factory_id");
		expect(contract.requiredContextKeys).toContain("trust_domain");
		expect(contract.requiredContextKeys).toContain("trust_role");
	});

	it("requiredRoles matches release_narrator role contract", () => {
		const contract = loadContract();
		expect([...contract.requiredRoles].sort()).toEqual([".release_narrator"]);
	});

	it("requiredHandlers is non-empty and contains tool + codergen", () => {
		const contract = loadContract();
		expect(Array.isArray(contract.requiredHandlers)).toBe(true);
		expect(contract.requiredHandlers.length).toBeGreaterThan(0);
		expect(contract.requiredHandlers).toContain("tool");
		expect(contract.requiredHandlers).toContain("codergen");
	});
});
