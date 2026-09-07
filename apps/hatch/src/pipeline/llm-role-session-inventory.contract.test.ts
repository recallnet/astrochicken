import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	collectLlmRoleSessionInventory,
	renderLlmRoleSessionInventoryMarkdown,
	type LlmRoleSessionInventory,
} from "./llm-role-session-inventory.js";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const INVENTORY_JSON_PATH = join(REPO_ROOT, "factories/mothership/inventory/llm-role-session-baseline.json");
const INVENTORY_MD_PATH = join(REPO_ROOT, "factories/mothership/inventory/llm-role-session-baseline.md");

function loadBaseline(): LlmRoleSessionInventory {
	return JSON.parse(readFileSync(INVENTORY_JSON_PATH, "utf-8")) as LlmRoleSessionInventory;
}

function projectClassSnapshot(inventory: LlmRoleSessionInventory): Record<string, string> {
	return Object.fromEntries(inventory.nodes.map((entry) => [`${entry.graph_path}::${entry.node_id}`, entry.class]));
}

function projectHandlerSnapshot(inventory: LlmRoleSessionInventory): Record<string, string> {
	return Object.fromEntries(inventory.nodes.map((entry) => [`${entry.graph_path}::${entry.node_id}`, entry.handler_type]));
}

function projectProviderModelSnapshot(inventory: LlmRoleSessionInventory): Record<string, { provider: string; model: string }> {
	return Object.fromEntries(
		inventory.nodes.map((entry) => [
			`${entry.graph_path}::${entry.node_id}`,
			{ provider: entry.provider, model: entry.model },
		]),
	);
}

function projectSessionSnapshot(inventory: LlmRoleSessionInventory): Record<string, string> {
	return Object.fromEntries(
		inventory.nodes.map((entry) => [`${entry.graph_path}::${entry.node_id}`, entry.session_id_expression]),
	);
}

function projectLlmPathSnapshot(inventory: LlmRoleSessionInventory): Record<string, string> {
	return Object.fromEntries(
		inventory.nodes.map((entry) => [`${entry.graph_path}::${entry.node_id}`, entry.llm_path_id]),
	);
}

function projectPayloadSnapshot(inventory: LlmRoleSessionInventory): Record<string, { contract: string; fingerprint: string }> {
	return Object.fromEntries(
		inventory.nodes.map((entry) => [
			`${entry.graph_path}::${entry.node_id}`,
			{ contract: entry.payload_contract_id, fingerprint: entry.payload_fingerprint },
		]),
	);
}

function projectPayloadEvidenceSnapshot(inventory: LlmRoleSessionInventory): Record<string, { template_hash: string; dependency_count: number }> {
	return Object.fromEntries(
		inventory.nodes.map((entry) => [
			`${entry.graph_path}::${entry.node_id}`,
			{
				template_hash: entry.payload_evidence.prompt_template_hash,
				dependency_count: entry.payload_evidence.prompt_dependencies.length,
			},
		]),
	);
}

function projectTrustRoleSnapshot(inventory: LlmRoleSessionInventory): Record<string, string> {
	return Object.fromEntries(inventory.nodes.map((entry) => [`${entry.graph_path}::${entry.node_id}`, entry.trust_role]));
}

describe("llm role/session inventory baseline", () => {
	const liveInventory = collectLlmRoleSessionInventory({ repoRootPath: REPO_ROOT });
	const baseline = loadBaseline();

	it("machine-readable inventory stays aligned with the live graphs and stylesheets", () => {
		expect(liveInventory).toEqual(baseline);
	});

	it("human-readable summary stays aligned with the generated inventory", () => {
		const summary = readFileSync(INVENTORY_MD_PATH, "utf-8");
		expect(summary).toBe(renderLlmRoleSessionInventoryMarkdown(liveInventory));
	});

	it("preserves the node to class snapshot", () => {
		expect(projectClassSnapshot(liveInventory)).toEqual(projectClassSnapshot(baseline));
	});

	it("preserves the node to handler type snapshot", () => {
		expect(projectHandlerSnapshot(liveInventory)).toEqual(projectHandlerSnapshot(baseline));
	});

	it("preserves the node to provider/model snapshot", () => {
		expect(projectProviderModelSnapshot(liveInventory)).toEqual(projectProviderModelSnapshot(baseline));
	});

	it("preserves the node to session_id expression snapshot", () => {
		expect(projectSessionSnapshot(liveInventory)).toEqual(projectSessionSnapshot(baseline));
	});

	it("preserves the node to llm path snapshot", () => {
		expect(projectLlmPathSnapshot(liveInventory)).toEqual(projectLlmPathSnapshot(baseline));
	});

	it("preserves the node to payload contract/fingerprint snapshot", () => {
		expect(projectPayloadSnapshot(liveInventory)).toEqual(projectPayloadSnapshot(baseline));
	});

	it("preserves the node to payload evidence snapshot", () => {
		expect(projectPayloadEvidenceSnapshot(liveInventory)).toEqual(projectPayloadEvidenceSnapshot(baseline));
	});

	it("preserves the node to trust role snapshot", () => {
		expect(projectTrustRoleSnapshot(liveInventory)).toEqual(projectTrustRoleSnapshot(baseline));
	});
});
