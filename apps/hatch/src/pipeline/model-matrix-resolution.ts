import {
	graphModelMatrix,
	nodeLLMModel,
	nodeModelMatrix,
	type Graph,
	type Node,
} from "./graph.js";
import {
	loadAndValidateModelMatricesForGraph,
	type LoadedModelMatrixDocument,
	type ModelMatrixLoadFileSystem,
} from "./model-matrix-loader.js";

export type ModelRoutingFamily = "model_matrix" | "llm_model" | "none";
export type ModelRoutingProvenance = "node" | "graph" | "none";

export interface EffectiveModelRoutingSelection {
	family: ModelRoutingFamily;
	value: string;
	provenance: ModelRoutingProvenance;
	attribute: "model_matrix" | "llm_model" | "none";
}

export const MODEL_MATRIX_RESOLUTION_RULE_CODES = {
	GRAPH_SCOPE_CONFLICT: "model_matrix_resolution.graph.conflict",
	NODE_SCOPE_CONFLICT: "model_matrix_resolution.node.conflict",
} as const;

export type ModelMatrixResolutionRuleCode =
	(typeof MODEL_MATRIX_RESOLUTION_RULE_CODES)[keyof typeof MODEL_MATRIX_RESOLUTION_RULE_CODES];

export class ModelMatrixResolutionError extends Error {
	readonly code: ModelMatrixResolutionRuleCode;
	readonly scope: "graph" | "node";
	readonly nodeId?: string;

	constructor(args: {
		code: ModelMatrixResolutionRuleCode;
		scope: "graph" | "node";
		message: string;
		nodeId?: string;
	}) {
		super(args.message);
		this.name = "ModelMatrixResolutionError";
		this.code = args.code;
		this.scope = args.scope;
		this.nodeId = args.nodeId;
	}
}

export function resolveEffectiveModelRoutingForGraph(g: Graph): EffectiveModelRoutingSelection {
	assertGraphScopeExclusivity(g);

	const matrix = graphModelMatrix(g);
	if (hasRoutingValue(matrix)) {
		return {
			family: "model_matrix",
			value: matrix,
			provenance: "graph",
			attribute: "model_matrix",
		};
	}

	const llmModel = graphLLMModel(g);
	if (hasRoutingValue(llmModel)) {
		return {
			family: "llm_model",
			value: llmModel,
			provenance: "graph",
			attribute: "llm_model",
		};
	}

	return {
		family: "none",
		value: "",
		provenance: "none",
		attribute: "none",
	};
}

export function resolveEffectiveModelRoutingForNode(
	g: Graph,
	n: Node,
	opts?: { skipGraphScopeValidation?: boolean },
): EffectiveModelRoutingSelection {
	if (!opts?.skipGraphScopeValidation) {
		assertGraphScopeExclusivity(g);
	}
	assertNodeScopeExclusivity(n);

	const nodeMatrix = nodeModelMatrix(n);
	if (hasRoutingValue(nodeMatrix)) {
		return {
			family: "model_matrix",
			value: nodeMatrix,
			provenance: "node",
			attribute: "model_matrix",
		};
	}

	const graphMatrix = graphModelMatrix(g);
	if (hasRoutingValue(graphMatrix)) {
		return {
			family: "model_matrix",
			value: graphMatrix,
			provenance: "graph",
			attribute: "model_matrix",
		};
	}

	const nodeModel = nodeLLMModel(n);
	if (hasRoutingValue(nodeModel)) {
		return {
			family: "llm_model",
			value: nodeModel,
			provenance: "node",
			attribute: "llm_model",
		};
	}

	const graphModel = graphLLMModel(g);
	if (hasRoutingValue(graphModel)) {
		return {
			family: "llm_model",
			value: graphModel,
			provenance: "graph",
			attribute: "llm_model",
		};
	}

	return {
		family: "none",
		value: "",
		provenance: "none",
		attribute: "none",
	};
}

export function enforceModelMatrixContractsAtLoad(args: {
	graph: Graph;
	workDir: string;
	fs?: ModelMatrixLoadFileSystem;
}): LoadedModelMatrixDocument[] {
	assertGraphScopeExclusivity(args.graph);
	for (const node of sortedGraphNodes(args.graph)) {
		assertNodeScopeExclusivity(node);
	}
	return loadAndValidateModelMatricesForGraph({
		graph: args.graph,
		workDir: args.workDir,
		fs: args.fs,
	});
}

function assertGraphScopeExclusivity(g: Graph): void {
	const matrix = graphModelMatrix(g);
	const llmModel = graphLLMModel(g);
	if (hasRoutingValue(matrix) && hasRoutingValue(llmModel)) {
		throw new ModelMatrixResolutionError({
			code: MODEL_MATRIX_RESOLUTION_RULE_CODES.GRAPH_SCOPE_CONFLICT,
			scope: "graph",
			message:
				'graph sets both "model_matrix" and "llm_model"; choose exactly one model routing attribute at graph scope',
		});
	}
}

function assertNodeScopeExclusivity(n: Node): void {
	const matrix = nodeModelMatrix(n);
	const llmModel = nodeLLMModel(n);
	if (hasRoutingValue(matrix) && hasRoutingValue(llmModel)) {
		throw new ModelMatrixResolutionError({
			code: MODEL_MATRIX_RESOLUTION_RULE_CODES.NODE_SCOPE_CONFLICT,
			scope: "node",
			nodeId: n.id,
			message:
				`node "${n.id}" sets both "model_matrix" and "llm_model"; choose exactly one model routing attribute at node scope`,
		});
	}
}

function graphLLMModel(g: Graph): string {
	return g.attrs["llm_model"] ?? "";
}

function sortedGraphNodes(graph: Graph): Node[] {
	return Object.values(graph.nodes).sort((left, right) => left.id.localeCompare(right.id));
}

function hasRoutingValue(value: string): boolean {
	return value.trim() !== "";
}
