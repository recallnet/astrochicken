import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { parseWithAst } from "./parse.js";
import {
	GOAL_DECOMPOSITION_TIMEOUT_STAGES,
	resolveGoalDecompositionTimeouts,
	type GoalDecompositionTimeoutResolution,
	type GoalDecompositionTimeoutStage,
} from "../factory/goal-decomposition-timeouts.js";

const DEFAULT_REPO_ROOT = resolve(import.meta.dirname, "../../../../");
const DEFAULT_FACTORY_ROOT = "factories/mothership";
const DEFAULT_FACTORY_CONFIG_PATH = `${DEFAULT_FACTORY_ROOT}/factory.config.json`;

const GOAL_DECOMPOSITION_STAGE_OWNERSHIP: Record<GoalDecompositionTimeoutStage, { graph_path: string; node_id: string }> = Object.freeze({
	issue_draft: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "draft_issue_spec",
	},
	issue_repair: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "repair_issue_spec",
	},
	issue_judge: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "judge_issue",
	},
	issue_revise: {
		graph_path: "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
		node_id: "revise_issue_spec",
	},
	triage_plan: {
		graph_path: "packages/capability-triage/graphs/triage.dot",
		node_id: "plan",
	},
	triage_repair: {
		graph_path: "packages/capability-triage/graphs/triage.dot",
		node_id: "repair_plan",
	},
});

export interface GoalDecompositionTimeoutEntry {
	stage: GoalDecompositionTimeoutStage;
	graph_path: string;
	node_id: string;
	timeout: string;
	timeout_ms: number;
	source: "default" | "override";
	source_key_path: string;
	default_timeout: string;
	override_timeout: string;
}

export interface GoalDecompositionTimeoutInventory {
	schema_version: "goal_decomposition_timeout_inventory/v1";
	factory_root: string;
	factory_config_path: string;
	entries: GoalDecompositionTimeoutEntry[];
}

export function collectGoalDecompositionTimeoutInventory(args?: {
	repoRootPath?: string;
	factoryRoot?: string;
	factoryConfigPath?: string;
}): GoalDecompositionTimeoutInventory {
	const repoRootPath = resolve(args?.repoRootPath || DEFAULT_REPO_ROOT);
	const factoryRoot = args?.factoryRoot || DEFAULT_FACTORY_ROOT;
	const factoryConfigPath = args?.factoryConfigPath || DEFAULT_FACTORY_CONFIG_PATH;
	const resolvedFactoryConfigPath = resolve(repoRootPath, factoryConfigPath);
	const factoryConfig = readFactoryConfigJson(resolvedFactoryConfigPath);
	const resolvedTimeouts = resolveGoalDecompositionTimeouts(factoryConfig);
	const graphNodeIndexes = new Map<string, Set<string>>();

	const entries: GoalDecompositionTimeoutEntry[] = GOAL_DECOMPOSITION_TIMEOUT_STAGES.map((stage) => {
		const ownership = GOAL_DECOMPOSITION_STAGE_OWNERSHIP[stage];
		const resolution = resolvedTimeouts[stage];
		if (!ownership || !resolution) {
			throw new Error(`[goal-decomposition-timeout-inventory] stage resolution missing for ${stage}`);
		}

		const graphFile = resolve(repoRootPath, ownership.graph_path);
		if (!graphNodeIndexes.has(graphFile)) {
			graphNodeIndexes.set(graphFile, loadNodeIds(graphFile));
		}
		const nodeIds = graphNodeIndexes.get(graphFile);
		if (!nodeIds || !nodeIds.has(ownership.node_id)) {
			throw new Error(
				`[goal-decomposition-timeout-inventory] required node ${ownership.graph_path}::${ownership.node_id} is missing`,
			);
		}

		return createInventoryEntry(stage, ownership, resolution);
	});

	entries.sort((left, right) => left.stage.localeCompare(right.stage));

	return {
		schema_version: "goal_decomposition_timeout_inventory/v1",
		factory_root: factoryRoot,
		factory_config_path: toRepoRelativePath(resolvedFactoryConfigPath, repoRootPath),
		entries,
	};
}

export function renderGoalDecompositionTimeoutInventoryMarkdown(inventory: GoalDecompositionTimeoutInventory): string {
	const lines = [
		"# Goal-Decomposition Timeout Inventory",
		"",
		"Generated from the goal-decomposition timeout resolver plus graph/node ownership contract checks.",
		"",
		`Machine-readable source: \`factories/mothership/inventory/goal-decomposition-timeouts.json\``,
		`Capability defaults source: \`packages/capability-goal-decomposition/timeouts.defaults.json\``,
		`Factory root: \`${inventory.factory_root}\``,
		"Factory override root: `capabilities.goal_decomposition.timeouts`",
		`Factory config: \`${inventory.factory_config_path}\``,
		`Stages: ${inventory.entries.length}`,
		"",
		"## Effective Budgets",
		"",
		"| Stage | Graph | Node | Timeout | Timeout (ms) | Source | Source key | Default | Override |",
		"| --- | --- | --- | --- | ---: | --- | --- | --- | --- |",
		...inventory.entries.map((entry) => (
			`| \`${entry.stage}\` | \`${entry.graph_path}\` | \`${entry.node_id}\` | \`${entry.timeout}\` | ${entry.timeout_ms} | \`${entry.source}\` | \`${entry.source_key_path}\` | \`${entry.default_timeout}\` | ${entry.override_timeout ? `\`${entry.override_timeout}\`` : "_"} |`
		)),
		"",
	];

	return lines.join("\n");
}

function createInventoryEntry(
	stage: GoalDecompositionTimeoutStage,
	ownership: { graph_path: string; node_id: string },
	resolution: GoalDecompositionTimeoutResolution,
): GoalDecompositionTimeoutEntry {
	return {
		stage,
		graph_path: ownership.graph_path,
		node_id: ownership.node_id,
		timeout: resolution.timeout,
		timeout_ms: resolution.timeout_ms,
		source: resolution.source,
		source_key_path: resolution.source_key_path,
		default_timeout: resolution.default_timeout,
		override_timeout: resolution.override_timeout,
	};
}

function loadNodeIds(graphFile: string): Set<string> {
	if (!existsSync(graphFile)) {
		throw new Error(`[goal-decomposition-timeout-inventory] required graph file is missing: ${graphFile}`);
	}
	const parsed = parseWithAst(readFileSync(graphFile, "utf-8"));
	return new Set(Object.keys(parsed.graph.nodes));
}

function readFactoryConfigJson(factoryConfigPath: string): Record<string, unknown> {
	if (!existsSync(factoryConfigPath)) {
		throw new Error(`[goal-decomposition-timeout-inventory] factory config is missing: ${factoryConfigPath}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(factoryConfigPath, "utf-8"));
	} catch (error) {
		throw new Error(
			`[goal-decomposition-timeout-inventory] failed to parse factory config at ${factoryConfigPath}: ${String(error)}`,
		);
	}

	if (!isPlainObject(parsed)) {
		throw new Error(`[goal-decomposition-timeout-inventory] factory config must be a JSON object: ${factoryConfigPath}`);
	}

	return parsed;
}

function toRepoRelativePath(path: string, repoRootPath: string): string {
	return relative(repoRootPath, path).split("\\").join("/");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
