import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	formatPolicyPackIssue as formatPolicyPackIssueViaConfig,
	loadPolicyPackDocuments as loadPolicyPackDocumentsViaConfig,
	validatePolicyPackContract as validatePolicyPackContractViaConfig,
} from "./config-schema.js";
import {
	formatPolicyPackIssue,
	loadPolicyPackDocuments,
	validatePolicyPackContract,
	validatePolicyPackMetadata,
} from "./policy-pack.js";
import { printHelpTopic } from "../help.js";

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("policy pack helpers", () => {
	let root = "";

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("loads policy pack documents through config-schema re-exports and validates contract metadata", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-policy-pack-"));
		writeJson(join(root, "metadata.json"), {
			version: "v1",
			owned_by: "factory-platform",
			files: {
				supervisor: "supervisor-policy.json",
			},
			required_keys: {
				supervisor: ["shared.max_review_retries"],
			},
			customizable_keys: {
				supervisor: ["factory.max_review_retries"],
			},
		});
		writeJson(join(root, "supervisor-policy.json"), {
			shared: { max_review_retries: 2 },
			factory: { max_review_retries: 2 },
		});

		expect(loadPolicyPackDocumentsViaConfig).toBe(loadPolicyPackDocuments);
		expect(validatePolicyPackContractViaConfig).toBe(validatePolicyPackContract);
		expect(formatPolicyPackIssueViaConfig).toBe(formatPolicyPackIssue);

		const documents = loadPolicyPackDocuments(root);
		expect(documents.metadata.owned_by).toBe("factory-platform");
		expect(documents.policies.supervisor).toEqual({
			shared: { max_review_retries: 2 },
			factory: { max_review_retries: 2 },
		});

		expect(validatePolicyPackMetadata(documents.metadata)).toEqual([]);
		expect(
			validatePolicyPackContract({
				policyPack: {
					version: "v1",
					overrides: {
						supervisor: {
							factory: {
								max_review_retries: 5,
							},
						},
					},
				},
				metadata: documents.metadata,
				policies: documents.policies,
			}),
		).toEqual([]);

		const issues = validatePolicyPackContract({
			policyPack: {
				version: "v2",
				overrides: {
					supervisor: {
						shared: {
							max_review_retries: 9,
						},
					},
				},
			},
			metadata: documents.metadata,
			policies: documents.policies,
		});
		expect(issues).toHaveLength(2);
		expect(formatPolicyPackIssue(issues[0]!)).toContain("policyPack.version mismatch");
		expect(formatPolicyPackIssue(issues[1]!)).toContain("overrides forbidden key");
	});

	it("prints help topics and exits deterministically for unknown topics", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		printHelpTopic("nodes");
		expect(log).toHaveBeenCalled();

		expect(() => printHelpTopic("not-a-topic")).toThrow("exit:1");
		expect(error).toHaveBeenCalledWith('Unknown help topic: "not-a-topic"\n');
		expect(exit).toHaveBeenCalledWith(1);
	});
});
