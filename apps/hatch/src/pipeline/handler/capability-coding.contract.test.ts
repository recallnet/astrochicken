import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface CapabilityContract {
	packageName: string;
	version: string;
	entrypoints: { kind: string; path: string }[];
	skillPaths: string[];
	requiredContextKeys: string[];
	requiredRoles: string[];
	requiredHandlers: string[];
}

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
const CAPABILITY_ROOT = resolve(REPO_ROOT, "packages/capability-coding");
const CAPABILITY_CONTRACT_PATH = resolve(CAPABILITY_ROOT, "capability-contract.v1.json");

function loadContract(): CapabilityContract {
	const raw = readFileSync(CAPABILITY_CONTRACT_PATH, "utf8");
	return JSON.parse(raw) as CapabilityContract;
}

function declaredGraphs(contract: CapabilityContract): string[] {
	return contract.entrypoints.filter((entrypoint) => entrypoint.kind === "graph").map((entrypoint) => entrypoint.path);
}

describe("@hatch/capability-coding manifest contract", () => {
	it("declares files that exist on disk", () => {
		const contract = loadContract();

		expect(contract.packageName).toBe("@hatch/capability-coding");
		expect(contract.version.length).toBeGreaterThan(0);
		expect(Array.isArray(contract.entrypoints)).toBe(true);
		expect(Array.isArray(contract.skillPaths)).toBe(true);
		expect(declaredGraphs(contract).length).toBeGreaterThan(0);
		expect(contract.skillPaths.length).toBeGreaterThan(0);

		for (const graphPath of declaredGraphs(contract)) {
			const absolutePath = resolve(CAPABILITY_ROOT, graphPath);
			expect(existsSync(absolutePath), `declared graph missing: ${graphPath}`).toBe(true);
		}

		for (const skillPath of contract.skillPaths) {
			const absolutePath = resolve(CAPABILITY_ROOT, skillPath);
			expect(existsSync(absolutePath), `declared skill missing: ${skillPath}`).toBe(true);
		}
	});

	it("declares required context keys, roles, and handlers", () => {
		const contract = loadContract();
		const requiredContext = new Set(contract.requiredContextKeys || []);
		const requiredRoles = new Set(contract.requiredRoles || []);
		const requiredHandlers = new Set(contract.requiredHandlers || []);

		expect(requiredContext.has("capability_coding_skills")).toBe(true);
		expect(requiredContext.has("trust_domain")).toBe(true);
		expect(requiredContext.has("trust_role")).toBe(true);
		expect(requiredContext.has("factory_root")).toBe(true);

		expect(requiredRoles.has(".coder")).toBe(true);
		expect(requiredRoles.has(".reviewer")).toBe(true);

		expect(requiredHandlers.has("agent.worktree")).toBe(true);
		expect(requiredHandlers.has("codergen")).toBe(true);
		expect(requiredHandlers.has("tool")).toBe(true);
	});
});
