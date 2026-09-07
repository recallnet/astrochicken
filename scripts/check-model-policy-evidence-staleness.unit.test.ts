import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	checkModelPolicyEvidenceStaleness,
	discoverModelPolicyFiles,
	formatModelPolicyEvidenceStalenessLines,
} from "./check-model-policy-evidence-staleness.ts";

function createFixtureRoot() {
	return mkdtempSync(join(tmpdir(), "model-policy-evidence-staleness-"));
}

function writePolicyFile(root, relativePath, payload) {
	const absolutePath = join(root, relativePath);
	mkdirSync(join(absolutePath, ".."), { recursive: true });
	writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`);
	return absolutePath;
}

describe("check-model-policy-evidence-staleness", () => {
	it("fresh evidence_date produces no stale warnings and result=ok", () => {
		const root = createFixtureRoot();
		writePolicyFile(root, "factories/mothership/policy-pack/v1/model-policy.json", {
			factory: {
				benchmark_justification: {
					evidence_date: "2026-03-11",
				},
			},
		});
		const policyFiles = discoverModelPolicyFiles({ repoRoot: root });
		const result = checkModelPolicyEvidenceStaleness({
			policyFiles,
			thresholdDays: 90,
			nowMs: Date.parse("2026-03-11T12:00:00.000Z"),
			repoRoot: root,
		});
		const lines = formatModelPolicyEvidenceStalenessLines(result);

		assert.equal(result.stale_count, 0);
		assert.equal(lines.some((line) => line.startsWith("model_policy_evidence_stale ")), false);
		assert.equal(lines.at(-1), "[model-policy-staleness] result=ok");
	});

	it("stale evidence_date emits warning with factory_id, evidence_date, and age_days", () => {
		const root = createFixtureRoot();
		writePolicyFile(root, "examples/external-factories/acme-support/policy-pack/v1/model-policy.json", {
			factory: {
				benchmark_justification: {
					evidence_date: "2025-08-23",
				},
			},
		});
		const policyFiles = discoverModelPolicyFiles({ repoRoot: root });
		const result = checkModelPolicyEvidenceStaleness({
			policyFiles,
			thresholdDays: 90,
			nowMs: Date.parse("2026-03-11T00:00:00.000Z"),
			repoRoot: root,
		});
		const lines = formatModelPolicyEvidenceStalenessLines(result);

		assert.equal(result.stale_count, 1);
		assert.equal(result.stale[0]?.factory_id, "acme-support");
		assert.equal(result.stale[0]?.evidence_date, "2025-08-23");
		assert.ok((result.stale[0]?.age_days || 0) >= 200);
		assert.ok(
			lines.some((line) =>
				/^model_policy_evidence_stale factory_id=acme-support evidence_date=2025-08-23 age_days=\d+$/.test(line),
			),
		);
		assert.equal(lines.at(-1), "[model-policy-staleness] result=warning_only stale_count=1");
	});

	it("missing evidence_date is skipped gracefully with result=ok", () => {
		const root = createFixtureRoot();
		writePolicyFile(root, "factories/acme-support/policy-pack/v1/model-policy.json", {
			factory: {
				provider_order: ["openrouter"],
			},
		});
		const policyFiles = discoverModelPolicyFiles({ repoRoot: root });
		const result = checkModelPolicyEvidenceStaleness({
			policyFiles,
			thresholdDays: 90,
			nowMs: Date.parse("2026-03-11T00:00:00.000Z"),
			repoRoot: root,
		});
		const lines = formatModelPolicyEvidenceStalenessLines(result);

		assert.equal(result.stale_count, 0);
		assert.equal(lines.some((line) => line.startsWith("model_policy_evidence_stale ")), false);
		assert.equal(lines.at(-1), "[model-policy-staleness] result=ok");
	});
});
