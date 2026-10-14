import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-wave-dispatch");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

describe("@hatch/capability-wave-dispatch manifest contract", () => {
	registerFilesystemContract();

	it("requiredContextKeys includes dispatch portability keys", () => {
		const contract = loadContract();
		expect(contract.requiredContextKeys).toContain("gh_repo");
		expect(contract.requiredContextKeys).toContain("factory_id");
		expect(contract.requiredContextKeys).toContain("factory_root");
		expect(contract.requiredContextKeys).toContain("trust_domain");
		expect(contract.requiredContextKeys).toContain("trust_role");
	});

	it("requiredHandlers is non-empty and contains tool", () => {
		const contract = loadContract();
		expect(Array.isArray(contract.requiredHandlers)).toBe(true);
		expect(contract.requiredHandlers.length).toBeGreaterThan(0);
		expect(contract.requiredHandlers).toContain("tool");
	});
});
