import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-product-judge");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

describe("@hatch/capability-product-judge manifest contract", () => {
	registerFilesystemContract();

	it("requiredContextKeys includes trust_domain and trust_role", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("trust_domain");
		expect(contract.requiredContextKeys).toContain("trust_role");
	});

	it("requiredRoles contains .post_merge_judge", () => {
		const contract = loadContract();
		expect(contract.requiredRoles).toContain(".post_merge_judge");
		expect(contract.requiredRoles).not.toContain(".judge");
	});

	it("requiredHandlers is a non-empty array containing tool", () => {
		const contract = loadContract();
		expect(Array.isArray(contract.requiredHandlers)).toBe(true);
		expect(contract.requiredHandlers.length).toBeGreaterThan(0);
		expect(contract.requiredHandlers).toContain("tool");
	});
});
