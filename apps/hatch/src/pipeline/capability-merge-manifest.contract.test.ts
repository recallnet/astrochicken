import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-merge");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

describe("@hatch/capability-merge manifest contract", () => {
	registerFilesystemContract();

	it("requiredContextKeys includes capability_merge_skills, trust_domain, and trust_role", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("capability_merge_skills");
		expect(contract.requiredContextKeys).toContain("trust_domain");
		expect(contract.requiredContextKeys).toContain("trust_role");
	});

	it("requiredRoles contains .merge_resolver", () => {
		const contract = loadContract();
		expect(contract.requiredRoles).toContain(".merge_resolver");
	});

	it("requiredHandlers is a non-empty array containing tool", () => {
		const contract = loadContract();
		expect(Array.isArray(contract.requiredHandlers)).toBe(true);
		expect(contract.requiredHandlers.length).toBeGreaterThan(0);
		expect(contract.requiredHandlers).toContain("tool");
	});
});
