import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-artifact-ingestion");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

describe("@hatch/capability-artifact-ingestion manifest contract", () => {
	registerFilesystemContract({ checkSkills: false });

	it("requiredContextKeys includes trust_domain and trust_role", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("trust_domain");
		expect(contract.requiredContextKeys).toContain("trust_role");
	});

	it("requiredHandlers is a non-empty array containing tool", () => {
		const contract = loadContract();
		expect(Array.isArray(contract.requiredHandlers)).toBe(true);
		expect(contract.requiredHandlers.length).toBeGreaterThan(0);
		expect(contract.requiredHandlers).toContain("tool");
	});
});
