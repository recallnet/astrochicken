/**
 * Runtime alignment contract: supervisor-policy.json shared.max_review_retries
 * must be a positive integer across all policy packs.
 *
 * Previously this validated against DEFAULT_MAX_REVIEW_ATTEMPTS from the
 * deleted goal-issue-state.mjs module. The module was removed as part of the
 * wave→goal migration. The policy-pack self-consistency checks remain.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

function loadSupervisorPolicyMaxRetries(policyPackRoot: string): number {
	const policyPath = resolve(policyPackRoot, "supervisor-policy.json");
	const raw = readFileSync(policyPath, "utf8");
	const doc = JSON.parse(raw) as { shared?: { max_review_retries?: number } };
	const val = doc?.shared?.max_review_retries;
	if (typeof val !== "number") {
		throw new Error(`shared.max_review_retries is not a number in ${policyPath} (got ${JSON.stringify(val)})`);
	}
	return val;
}

describe("policy-pack runtime alignment contract", () => {
	const POLICY_PACKS = [
		{
			name: "factories/_templates/policy-pack/v1",
			root: resolve(REPO_ROOT, "factories/_templates/policy-pack/v1"),
		},
		{
			name: "factories/mothership/policy-pack/v1",
			root: resolve(REPO_ROOT, "factories/mothership/policy-pack/v1"),
		},
		{
			name: "factories/example-trading/policy-pack/v1",
			root: resolve(REPO_ROOT, "factories/example-trading/policy-pack/v1"),
		},
		{
			name: "factories/brainstorm/policy-pack/v1",
			root: resolve(REPO_ROOT, "factories/brainstorm/policy-pack/v1"),
		},
		// @context:regression !critical issue #2573 removed example-web-local policy-pack files; example-web now resolves shared defaults via config-only managed runtime paths.
		{
			name: "examples/external-factories/acme-support/policy-pack/v1",
			root: resolve(REPO_ROOT, "examples/external-factories/acme-support/policy-pack/v1"),
		},
	];

	for (const pack of POLICY_PACKS) {
		it(`${pack.name}: shared.max_review_retries is a positive integer`, () => {
			const policyVal = loadSupervisorPolicyMaxRetries(pack.root);
			expect(typeof policyVal).toBe("number");
			expect(policyVal).toBeGreaterThan(0);
		});
	}

	it("block-wait-retry cooldown_minutes is a positive integer across all policy packs", () => {
		for (const pack of POLICY_PACKS) {
			const policyPath = resolve(pack.root, "block-wait-retry-policy.json");
			const doc = JSON.parse(readFileSync(policyPath, "utf8")) as {
				shared?: { wait?: { cooldown_minutes?: number } };
			};
			const policyMinutes = doc?.shared?.wait?.cooldown_minutes;
			expect(
				typeof policyMinutes,
				`${pack.name}: shared.wait.cooldown_minutes must be a number`,
			).toBe("number");
			expect(
				policyMinutes,
				`${pack.name}: shared.wait.cooldown_minutes must be positive`,
			).toBeGreaterThan(0);
		}
	});
});
