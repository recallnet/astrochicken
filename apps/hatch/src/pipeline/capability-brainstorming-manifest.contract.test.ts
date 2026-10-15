import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createCapabilityManifestFixture } from "./test/capability-manifest-support.js";

const CAPABILITY_ROOT = resolve(import.meta.dirname, "../../../../packages/capability-brainstorming");

const { loadContract, registerFilesystemContract } = createCapabilityManifestFixture(CAPABILITY_ROOT);

describe("@hatch/capability-brainstorming manifest contract", () => {
	registerFilesystemContract();

	it("requiredContextKeys includes brainstorming contract keys", () => {
    const contract = loadContract();
    expect(contract.requiredContextKeys).toContain("brainstorm_issue_number");
    expect(contract.requiredContextKeys).toContain("brainstorm_issue_body");
    expect(contract.requiredContextKeys).toContain("capability_brainstorming_skills");
    expect(contract.requiredContextKeys).toContain("trust_domain");
    expect(contract.requiredContextKeys).toContain("trust_role");
  });

  it("requiredRoles contains .red_strategist and .blue_strategist", () => {
    const contract = loadContract();
    expect(contract.requiredRoles).toContain(".red_strategist");
    expect(contract.requiredRoles).toContain(".blue_strategist");
  });

  it("requiredHandlers includes agent.kw and tool", () => {
    const contract = loadContract();
    expect(Array.isArray(contract.requiredHandlers)).toBe(true);
    expect(contract.requiredHandlers).toContain("agent.kw");
    expect(contract.requiredHandlers).toContain("tool");
  });
});
