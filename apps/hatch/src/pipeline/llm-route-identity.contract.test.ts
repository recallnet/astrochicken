import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildAllowedPayloadSharingPairs, loadLlmPayloadSharingAllowlist } from "./llm-payload-sharing-allowlist.js";
import { collectLlmRoleSessionInventory } from "./llm-role-session-inventory.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");

describe("LLM route identity contract", () => {
	const inventory = collectLlmRoleSessionInventory({ repoRootPath: REPO_ROOT });
	const sharingAllowlist = loadLlmPayloadSharingAllowlist({ repoRootPath: REPO_ROOT });
	const allowedPairs = buildAllowedPayloadSharingPairs(sharingAllowlist);

	it("assigns a unique llm_path_id to every active LLM route", () => {
		const pathIds = inventory.nodes.map((entry) => entry.llm_path_id);
		expect(pathIds.every((value) => value.length > 0)).toBe(true);
		expect(new Set(pathIds).size).toBe(pathIds.length);
	});

	it("binds every active LLM route to a semantic payload contract and fingerprint", () => {
		for (const entry of inventory.nodes) {
			expect(entry.payload_contract_id, `${entry.graph_path}::${entry.node_id} missing payload_contract_id`).not.toBe("");
			expect(entry.payload_fingerprint, `${entry.graph_path}::${entry.node_id} missing payload_fingerprint`).toMatch(/^sha256:/);
		}
	});

	it("fails closed if semantic routes share a payload without an explicit allowlist entry", () => {
		const fingerprintGroups = new Map<string, typeof inventory.nodes>();
		for (const entry of inventory.nodes) {
			const existing = fingerprintGroups.get(entry.payload_fingerprint) || [];
			existing.push(entry);
			fingerprintGroups.set(entry.payload_fingerprint, existing);
		}

		for (const [fingerprint, entries] of fingerprintGroups) {
			if (entries.length < 2) continue;
			const sortedPaths = entries.map((entry) => entry.llm_path_id).sort();
			for (let index = 0; index < sortedPaths.length - 1; index += 1) {
				for (let inner = index + 1; inner < sortedPaths.length; inner += 1) {
					const key = `${sortedPaths[index]}::${sortedPaths[inner]}`;
					expect(
						allowedPairs.has(key),
						`${fingerprint} reused without allowlist entry: ${sortedPaths[index]} vs ${sortedPaths[inner]}`,
					).toBe(true);
				}
			}
		}
	});

	it("fails closed if the allowlist references non-shared or unknown route pairs", () => {
		const knownPathIds = new Set(inventory.nodes.map((entry) => entry.llm_path_id));
		const sharedPairs = new Set<string>();
		const byFingerprint = new Map<string, string[]>();
		for (const entry of inventory.nodes) {
			const existing = byFingerprint.get(entry.payload_fingerprint) || [];
			existing.push(entry.llm_path_id);
			byFingerprint.set(entry.payload_fingerprint, existing);
		}
		for (const pathIds of byFingerprint.values()) {
			const sorted = [...pathIds].sort();
			for (let index = 0; index < sorted.length - 1; index += 1) {
				for (let inner = index + 1; inner < sorted.length; inner += 1) {
					sharedPairs.add(`${sorted[index]}::${sorted[inner]}`);
				}
			}
		}

		for (const entry of sharingAllowlist.entries) {
			const [left, right] = [...entry.llm_path_ids].map((value) => String(value || "").trim()).sort();
			expect(knownPathIds.has(left), `Unknown allowlist route: ${left}`).toBe(true);
			expect(knownPathIds.has(right), `Unknown allowlist route: ${right}`).toBe(true);
			expect(sharedPairs.has(`${left}::${right}`), `Stale allowlist entry: ${left} vs ${right}`).toBe(true);
		}
	});

	it("keeps supervisor bug-fast and review routes on distinct payloads", () => {
		const bugFast = inventory.nodes.find((entry) => entry.llm_path_id === "mothership.supervisor.review_bug_fast");
		const review = inventory.nodes.find((entry) => entry.llm_path_id === "mothership.supervisor.review");
		expect(bugFast).toBeTruthy();
		expect(review).toBeTruthy();
		expect(bugFast?.payload_fingerprint).not.toBe(review?.payload_fingerprint);
	});

	it("splits supervisor skill identities by route while preserving one shared supervisor session", () => {
		const bugFast = inventory.nodes.find((entry) => entry.llm_path_id === "mothership.supervisor.review_bug_fast");
		const review = inventory.nodes.find((entry) => entry.llm_path_id === "mothership.supervisor.review");
		expect(bugFast?.prompt_family_metadata.skill_id).toBe("supervisor.review_bug_fast");
		expect(review?.prompt_family_metadata.skill_id).toBe("supervisor.review");
		expect(bugFast?.session_id_expression).toBe("supervisor-${factory_id}");
		expect(review?.session_id_expression).toBe("supervisor-${factory_id}");
	});

	it("splits judge routes out of merge and issue-writer skill families", () => {
		const postMergeJudge = inventory.nodes.find((entry) => entry.llm_path_id === "mothership.goal_execute.post_merge_judge");
		const issueJudge = inventory.nodes.find((entry) => entry.llm_path_id === "capability.write_issue_item.judge_issue");
		const mergeResolver = inventory.nodes.find((entry) => entry.llm_path_id === "mothership.goal_execute.resolve_conflict");
		const issueWriter = inventory.nodes.find((entry) => entry.llm_path_id === "capability.write_issue_item.draft_issue_spec");
		expect(postMergeJudge?.prompt_family_metadata.skill_id).toBe("goal.execute.post_merge_judge");
		expect(issueJudge?.prompt_family_metadata.skill_id).toBe("goal.write_issue.judge");
		expect(mergeResolver?.prompt_family_metadata.skill_id).toBe("goal.execute.merge");
		expect(issueWriter?.prompt_family_metadata.skill_id).toBe("goal.write_issue");
	});

	it("captures prompt evidence for every active route", () => {
		for (const entry of inventory.nodes) {
			expect(entry.payload_evidence.prompt_template_hash).toMatch(/^sha256:/);
			expect(Array.isArray(entry.payload_evidence.prompt_dependencies)).toBe(true);
		}
	});
});
