import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFactoryConfigDocument } from "./config-schema.js";

import {
	loadPolicyPackDocuments,
	validatePolicyPackContract,
	validatePolicyPackMetadata,
	type FactoryPolicyPackConfigDocument,
	type PolicyPackDocuments,
} from "./policy-pack.js";

function loadTemplatePolicyPack(policyPackRoot: string): PolicyPackDocuments {
	return loadPolicyPackDocuments(policyPackRoot);
}

function getPathValue(value: unknown, dottedPath: string): unknown {
	const segments = dottedPath.split(".");
	let cursor: unknown = value;
	for (const segment of segments) {
		if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
			return undefined;
		}
		const objectCursor = cursor as Record<string, unknown>;
		if (!(segment in objectCursor)) {
			return undefined;
		}
		cursor = objectCursor[segment];
	}
	return cursor;
}

function assertCustomizableKeyCoverage(packName: string, docs: PolicyPackDocuments): void {
	for (const [policyName, customizablePaths] of Object.entries(docs.metadata.customizable_keys)) {
		const policyDocument = docs.policies[policyName];
		expect(
			policyDocument,
			`${packName}: metadata.customizable_keys references missing policy document "${policyName}"`,
		).toBeDefined();

		for (const customizablePath of customizablePaths) {
			expect(
				customizablePath.startsWith("factory."),
				`${packName}: customizable key must be factory-scoped (${policyName}.${customizablePath})`,
			).toBe(true);

			const pathValue = getPathValue(policyDocument, customizablePath);
			expect(
				pathValue,
				`${packName}: customizable key path missing (${policyName}.${customizablePath})`,
			).not.toBeUndefined();
		}
	}
}

function definePolicyPackTemplateContractSuite(packName: string, policyPackRoot: string): void {
	describe(packName, () => {
		it("passes metadata and contract validation", () => {
			const docs = loadTemplatePolicyPack(policyPackRoot);
			expect(validatePolicyPackMetadata(docs.metadata)).toEqual([]);
			const policyPack: FactoryPolicyPackConfigDocument = {
				version: docs.metadata.version,
				overrides: {},
			};
			expect(
				validatePolicyPackContract({
					policyPack,
					metadata: docs.metadata,
					policies: docs.policies,
				}),
			).toEqual([]);
		});

		it("ensures metadata.customizable_keys paths exist in policy documents", () => {
			const docs = loadTemplatePolicyPack(policyPackRoot);
			assertCustomizableKeyCoverage(packName, docs);
		});
	});
}

definePolicyPackTemplateContractSuite(
	"policy-pack template contract: factories/_templates/policy-pack/v1",
	resolve(process.cwd(), "../../factories/_templates/policy-pack/v1"),
);

definePolicyPackTemplateContractSuite(
	"policy-pack template contract: examples/external-factories/acme-support/policy-pack/v1",
	resolve(process.cwd(), "../../examples/external-factories/acme-support/policy-pack/v1"),
);

// Keep canonical template contract aligned with shipped production packs.
definePolicyPackTemplateContractSuite(
	"policy-pack template contract: factories/mothership/policy-pack/v1",
	resolve(process.cwd(), "../../factories/mothership/policy-pack/v1"),
);

// @context:regression The managed example is config-only; concrete template packs remain validated above.
it("example-trading has a valid shared-runtime configuration without a local policy-pack template", () => {
	const factoryRoot = resolve(import.meta.dirname, "../../../../factories/example-trading");
	const raw = JSON.parse(readFileSync(resolve(factoryRoot, "factory.config.json"), "utf8"));
	expect(() => parseFactoryConfigDocument(raw)).not.toThrow();
	expect(raw.policyPack).toBeUndefined();
	expect(existsSync(resolve(factoryRoot, "policy-pack"))).toBe(false);
	expect(raw.provider).toBe("openrouter");
	expect(raw.model).toBe("openai/gpt-5.3-codex");
});

definePolicyPackTemplateContractSuite(
	"policy-pack template contract: factories/brainstorm/policy-pack/v1",
	resolve(process.cwd(), "../../factories/brainstorm/policy-pack/v1"),
);

// @context:regression !critical issue #2573 moved example-web to config-only managed defaults without a local policy-pack directory.
// Keep this suite focused on factories that still ship concrete policy-pack files.
describe("release-policy required_checks alignment", () => {
	it("ensures stable/canary required_checks map to root package scripts", () => {
		const releasePolicyPath = resolve(
			process.cwd(),
			"../../factories/_templates/policy-pack/v1/release-policy.json",
		);
		const packageJsonPath = resolve(process.cwd(), "../../package.json");

		const releasePolicy = JSON.parse(readFileSync(releasePolicyPath, "utf-8")) as {
			shared?: {
				channels?: {
					stable?: { required_checks?: string[] };
					canary?: { required_checks?: string[] };
				};
			};
		};
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
			scripts?: Record<string, string>;
		};
		const scripts = packageJson.scripts ?? {};
		const stableChecks = releasePolicy.shared?.channels?.stable?.required_checks ?? [];
		const canaryChecks = releasePolicy.shared?.channels?.canary?.required_checks ?? [];

		for (const checkName of stableChecks) {
			expect(scripts, `stable required check missing npm script: ${checkName}`).toHaveProperty(
				checkName,
			);
		}
		for (const checkName of canaryChecks) {
			expect(scripts, `canary required check missing npm script: ${checkName}`).toHaveProperty(
				checkName,
			);
		}
	});
});
