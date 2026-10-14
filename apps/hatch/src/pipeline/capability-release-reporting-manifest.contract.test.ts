import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-release-reporting");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

describe("@hatch/capability-release-reporting manifest contract", () => {
	registerFilesystemContract();

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
