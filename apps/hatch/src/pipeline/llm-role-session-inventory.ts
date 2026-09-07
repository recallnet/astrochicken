import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeClass, nodeHandlerType, nodeLLMModel, nodeLLMProvider, nodePrompt, nodeTrustRole, type Node } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const require = createRequire(import.meta.url);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const DEFAULT_REPO_ROOT = resolve(MODULE_DIR, "../../../../");
const DEFAULT_FACTORY_ROOT = "factories/mothership";
const LLM_HANDLER_TYPES = new Set(["agent.kw", "agent.worktree", "codergen", "stack.manager_loop"]);

// Keep this aligned with packages/factory-ops/src/lib/active-graphs.ts.
const ACTIVE_FACTORY_GRAPH_ROOTS = Object.freeze([
	"factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
	"factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
	"factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/goal_queue/goal_queue.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/goal_batch/goal_batch.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/goal_factory/goal_factory.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/goal_intake_decompose/goal_intake_decompose.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
	"packages/capability-goal-decomposition/workflows/write_issues/write_issues.workflow-source.mjs",
	"packages/capability-merge/workflows/merge_item/merge_item.workflow-source.mjs",
	"packages/capability-artifact-ingestion/workflows/artifact_ingest/artifact_ingest.workflow-source.mjs",
]);

const PROMPT_METADATA_KEYS = Object.freeze([
	"benchmark_job_id",
	"prompt_source",
	"system_prompt_source",
	"task_prompt_source",
	"prompt_input_keys",
	"prompt_version",
	"role_version",
	"skill_id",
]);

export interface LlmRoleSessionInventoryEntry {
	graph_path: string;
	node_id: string;
	llm_path_id: string;
	class: string;
	handler_type: string;
	provider: string;
	model: string;
	trust_role: string;
	session_id_expression: string;
	payload_contract_id: string;
	payload_fingerprint: string;
	prompt_family_metadata: Record<string, string>;
	payload_evidence: {
		prompt_template_hash: string;
		prompt_dependencies: Array<Record<string, string>>;
	};
}

export interface LlmRoleSessionInventory {
	schema_version: "llm_role_session_inventory/v1";
	factory_root: string;
	active_graph_roots: string[];
	discovered_graphs: string[];
	nodes: LlmRoleSessionInventoryEntry[];
}

export function collectLlmRoleSessionInventory(args?: {
	repoRootPath?: string;
	factoryRoot?: string;
}): LlmRoleSessionInventory {
	const repoRootPath = resolve(args?.repoRootPath || DEFAULT_REPO_ROOT);
	const factoryRoot = args?.factoryRoot || DEFAULT_FACTORY_ROOT;
	const pending = ACTIVE_FACTORY_GRAPH_ROOTS.map((graphPath) => resolve(repoRootPath, graphPath));
	const visited = new Set<string>();
	const discoveredGraphs: string[] = [];
	const nodes: LlmRoleSessionInventoryEntry[] = [];

	while (pending.length > 0) {
		const graphFile = pending.shift();
		if (!graphFile || visited.has(graphFile)) {
			continue;
		}
		visited.add(graphFile);

		const source = readFileSync(graphFile, "utf-8");
		const parsed = parseWithAst(source);
		applyGraphStylesheetImports({
			graph: parsed.graph,
			graphFile,
			stylesheetImports: parsed.stylesheetImports,
			repoRootPath,
		});

		discoveredGraphs.push(toRepoRelativePath(graphFile, repoRootPath));

		for (const node of Object.values(parsed.graph.nodes)) {
			if (!isLlmNode(node)) {
				continue;
			}

			nodes.push({
				graph_path: toRepoRelativePath(graphFile, repoRootPath),
				node_id: node.id,
				llm_path_id: String(node.attrs["llm_path_id"] || ""),
				class: nodeClass(node),
				handler_type: nodeHandlerType(node),
				provider: nodeLLMProvider(node),
				model: nodeLLMModel(node),
				trust_role: nodeTrustRole(node),
				session_id_expression: String(node.attrs["session_id"] || ""),
				payload_contract_id: String(node.attrs["benchmark_job_id"] || ""),
				...computePayloadIdentity({
					node,
					graphNodes: Object.values(parsed.graph.nodes),
					graphFile,
					repoRootPath,
				}),
				prompt_family_metadata: collectPromptFamilyMetadata(node),
			});
		}

		for (const childGraph of collectChildGraphRefs({
			graphFile,
			nodeList: Object.values(parsed.graph.nodes),
			repoRootPath,
			factoryRoot,
		})) {
			if (!visited.has(childGraph)) {
				pending.push(childGraph);
			}
		}
	}

	discoveredGraphs.sort();
	nodes.sort(compareInventoryEntries);

	return {
		schema_version: "llm_role_session_inventory/v1",
		factory_root: factoryRoot,
		active_graph_roots: [...ACTIVE_FACTORY_GRAPH_ROOTS],
		discovered_graphs: discoveredGraphs,
		nodes,
	};
}

export function renderLlmRoleSessionInventoryMarkdown(inventory: LlmRoleSessionInventory): string {
	const lines = [
		"# LLM Role/Session Inventory Baseline",
		"",
		"Generated from the live active mothership graph set using DOT parsing and stylesheet resolution.",
		"",
		`Machine-readable source: \`factories/mothership/inventory/llm-role-session-baseline.json\``,
		"",
		`Active roots: ${inventory.active_graph_roots.length}`,
		`Discovered graphs: ${inventory.discovered_graphs.length}`,
		`LLM nodes: ${inventory.nodes.length}`,
		"",
		"## Graph Coverage",
		"",
		"| Graph |",
		"| --- |",
		...inventory.discovered_graphs.map((graphPath) => `| \`${graphPath}\` |`),
		"",
		"## Node Summary",
		"",
		"| Graph | Node | LLM Path | Class | Handler | Provider | Model | Trust Role | Session ID | Payload Contract | Payload Fingerprint | Prompt Metadata |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...inventory.nodes.map((entry) => {
			const promptMetadata = formatPromptMetadata(entry.prompt_family_metadata);
			return `| \`${entry.graph_path}\` | \`${entry.node_id}\` | ${formatCell(entry.llm_path_id)} | ${formatCell(entry.class)} | ${formatCell(entry.handler_type)} | ${formatCell(entry.provider)} | ${formatCell(entry.model)} | ${formatCell(entry.trust_role)} | ${formatCell(entry.session_id_expression)} | ${formatCell(entry.payload_contract_id)} | ${formatCell(entry.payload_fingerprint)} | ${formatCell(promptMetadata)} |`;
		}),
		"",
	];

	return lines.join("\n");
}

function compareInventoryEntries(left: LlmRoleSessionInventoryEntry, right: LlmRoleSessionInventoryEntry): number {
	return left.graph_path.localeCompare(right.graph_path)
		|| left.node_id.localeCompare(right.node_id);
}

function collectPromptFamilyMetadata(node: Node): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (const key of PROMPT_METADATA_KEYS) {
		const value = String(node.attrs[key] || "");
		if (value) {
			metadata[key] = value;
		}
	}
	return metadata;
}

function computePayloadIdentity(args: {
	node: Node;
	graphNodes: Node[];
	graphFile: string;
	repoRootPath: string;
}): {
	payload_fingerprint: string;
	payload_evidence: {
		prompt_template_hash: string;
		prompt_dependencies: Array<Record<string, string>>;
	};
} {
	const promptDependencies = collectPromptDependencies(args);
	const promptTemplate = nodePrompt(args.node);
	const payload = {
		class: nodeClass(args.node),
		handler_type: nodeHandlerType(args.node),
		provider: nodeLLMProvider(args.node),
		model: nodeLLMModel(args.node),
		trust_role: nodeTrustRole(args.node),
		skill_id: String(args.node.attrs["skill_id"] || ""),
		prompt_template: promptTemplate,
		prompt_family_metadata: collectPromptFamilyMetadata(args.node),
		prompt_dependencies: promptDependencies,
	};
	return {
		payload_fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
		payload_evidence: {
			prompt_template_hash: `sha256:${createHash("sha256").update(promptTemplate).digest("hex")}`,
			prompt_dependencies: promptDependencies,
		},
	};
}

function collectPromptDependencies(args: {
	node: Node;
	graphNodes: Node[];
	graphFile: string;
	repoRootPath: string;
}): Array<Record<string, string>> {
	const prompt = nodePrompt(args.node);
	if (!prompt) {
		return [];
	}
	const outputKeyToLoader = new Map<string, Node>();
	for (const candidate of args.graphNodes) {
		const outputKey = String(candidate.attrs["output_key"] || "").trim();
		if (outputKey && !outputKeyToLoader.has(outputKey)) {
			outputKeyToLoader.set(outputKey, candidate);
		}
	}

	const referencedOutputKeys = [...prompt.matchAll(/\$\{([^}]+)\}/g)]
		.map((match) => String(match[1] || "").trim())
		.filter(Boolean)
		.filter((key, index, values) => values.indexOf(key) === index)
		.filter((key) => outputKeyToLoader.has(key));

	return referencedOutputKeys.map((outputKey) => describePromptDependency({
		outputKey,
		loaderNode: outputKeyToLoader.get(outputKey)!,
		graphFile: args.graphFile,
		repoRootPath: args.repoRootPath,
	}));
}

function describePromptDependency(args: {
	outputKey: string;
	loaderNode: Node;
	graphFile: string;
	repoRootPath: string;
}): Record<string, string> {
	const descriptor: Record<string, string> = {
		output_key: args.outputKey,
		loader_node_id: args.loaderNode.id,
		loader_prompt: String(args.loaderNode.attrs["prompt"] || ""),
	};
	const catPath = catPathFromLoader(args.loaderNode);
	if (!catPath) {
		return descriptor;
	}
	if (catPath.includes("${")) {
		descriptor.source_path = catPath;
		return descriptor;
	}
	const resolvedPath = resolveGraphPath(catPath, dirname(args.graphFile), args.repoRootPath);
	if (!existsSync(resolvedPath)) {
		descriptor.source_path = catPath;
		return descriptor;
	}
	const source = readFileSync(resolvedPath, "utf-8");
	descriptor.source_path = toRepoRelativePath(resolvedPath, args.repoRootPath);
	descriptor.source_hash = `sha256:${createHash("sha256").update(source).digest("hex")}`;
	return descriptor;
}

function catPathFromLoader(node: Node): string {
	const prompt = String(node.attrs["prompt"] || "").trim();
	const match = prompt.match(/^cat\s+(.+)$/);
	if (!match) {
		return "";
	}
	return String(match[1] || "").replace(/^['"]|['"]$/g, "");
}

function collectChildGraphRefs(args: {
	graphFile: string;
	nodeList: Node[];
	repoRootPath: string;
	factoryRoot: string;
}): string[] {
	const childGraphs = new Set<string>();

	for (const node of args.nodeList) {
		for (const attrName of ["pipeline", "template"]) {
			const rawValue = String(node.attrs[attrName] || "").trim();
			if (!rawValue) {
				continue;
			}

			const expandedValue = rawValue.replaceAll("${factory_root}", args.factoryRoot);
			if (!expandedValue.endsWith(".dot")) {
				continue;
			}

			childGraphs.add(resolveGraphPath(expandedValue, dirname(args.graphFile), args.repoRootPath));
		}
	}

	return [...childGraphs];
}

function resolveGraphPath(rawPath: string, workDir: string, repoRootPath: string): string {
	if (rawPath.startsWith("@")) {
		const parts = rawPath.split("/");
		const hasScope = parts[0]?.startsWith("@");
		const packageDirName = hasScope ? parts[1] : parts[0];
		const packageSubPath = hasScope ? parts.slice(2).join("/") : parts.slice(1).join("/");
		if (packageDirName) {
			const workspacePath = resolve(repoRootPath, "packages", packageDirName, packageSubPath);
			if (existsSync(workspacePath)) {
				return workspacePath;
			}
		}
		return require.resolve(rawPath, { paths: [repoRootPath] });
	}
	if (rawPath.startsWith("/")) {
		return rawPath;
	}
	if (rawPath.startsWith("~")) {
		return rawPath.replace("~", process.env["HOME"] || "~");
	}
	if (rawPath.startsWith("factories/") || rawPath.startsWith("packages/")) {
		return resolve(repoRootPath, rawPath);
	}
	return resolve(workDir || repoRootPath, rawPath);
}

function isLlmNode(node: Node): boolean {
	const handlerType = nodeHandlerType(node);
	if (handlerType === "agent.worktree" || handlerType === "agent.kw" || handlerType === "stack.manager_loop") {
		return true;
	}

	return Boolean(nodeClass(node))
		|| Boolean(node.attrs["llm_provider"])
		|| Boolean(node.attrs["llm_model"])
		|| Boolean(node.attrs["session_id"])
		|| PROMPT_METADATA_KEYS.some((key) => Boolean(node.attrs[key]))
		|| (handlerType === "codergen" && (node.attrs["reviewer"] === "true" || node.attrs["judge"] === "true"));
}

function toRepoRelativePath(path: string, repoRootPath: string): string {
	const relativePath = relative(repoRootPath, path);
	return relativePath.split("\\").join("/");
}

function formatPromptMetadata(metadata: Record<string, string>): string {
	const entries = Object.entries(metadata);
	if (entries.length === 0) {
		return "";
	}
	return entries.map(([key, value]) => `${key}=${value}`).join("; ");
}

function formatCell(value: string): string {
	if (!value) {
		return "_";
	}
	return `\`${value.replaceAll("|", "\\|")}\``;
}
