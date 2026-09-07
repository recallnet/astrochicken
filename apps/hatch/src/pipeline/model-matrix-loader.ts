import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { Graph } from "./graph.js";
import {
	ModelMatrixValidationError,
	parseModelMatrixDocument,
	type ModelMatrixDocument,
	type ModelMatrixValidationIssue,
} from "./model-matrix-schema.js";

export const MODEL_MATRIX_LOAD_ERROR_CODES = {
	FILE_MISSING: "model_matrix_load.file.missing",
	FILE_UNREADABLE: "model_matrix_load.file.unreadable",
	JSON_INVALID: "model_matrix_load.json.invalid",
	SCHEMA_INVALID: "model_matrix_load.schema.invalid",
} as const;

export type ModelMatrixLoadErrorCode =
	(typeof MODEL_MATRIX_LOAD_ERROR_CODES)[keyof typeof MODEL_MATRIX_LOAD_ERROR_CODES];

export interface ModelMatrixLoadFileSystem {
	readFileSync(path: string, encoding: "utf-8"): string;
}

export interface ModelMatrixReference {
	scope: "graph" | "node";
	nodeId?: string;
	rawPath: string;
}

export interface LoadedModelMatrixDocument {
	rawPath: string;
	resolvedPath: string;
	source: string;
	document: ModelMatrixDocument;
}

export class ModelMatrixLoadError extends Error {
	readonly code: ModelMatrixLoadErrorCode;
	readonly rawPath: string;
	readonly resolvedPath: string;
	readonly source: string;
	readonly causeValue: unknown;
	readonly validationIssues: ModelMatrixValidationIssue[];

	constructor(args: {
		code: ModelMatrixLoadErrorCode;
		message: string;
		rawPath: string;
		resolvedPath: string;
		source: string;
		causeValue?: unknown;
		validationIssues?: ModelMatrixValidationIssue[];
	}) {
		super(args.message);
		this.name = this.constructor.name;
		this.code = args.code;
		this.rawPath = args.rawPath;
		this.resolvedPath = args.resolvedPath;
		this.source = args.source;
		this.causeValue = args.causeValue;
		this.validationIssues = args.validationIssues ?? [];
	}
}

const DEFAULT_FS: ModelMatrixLoadFileSystem = {
	readFileSync,
};

export function resolveModelMatrixPath(rawPath: string, workDir: string): string {
	const normalizedRawPath = String(rawPath || "").trim();
	if (!normalizedRawPath) {
		return "";
	}
	if (isAbsolute(normalizedRawPath)) {
		return resolve(normalizedRawPath);
	}
	return resolve(workDir || ".", normalizedRawPath);
}

export function collectModelMatrixReferences(graph: Graph): ModelMatrixReference[] {
	const references: ModelMatrixReference[] = [];
	const graphMatrix = String(graph.attrs["model_matrix"] || "").trim();
	if (graphMatrix) {
		references.push({
			scope: "graph",
			rawPath: graphMatrix,
		});
	}

	const sortedNodes = Object.values(graph.nodes).sort((left, right) => left.id.localeCompare(right.id));
	for (const node of sortedNodes) {
		const nodeMatrix = String(node.attrs["model_matrix"] || "").trim();
		if (!nodeMatrix) continue;
		references.push({
			scope: "node",
			nodeId: node.id,
			rawPath: nodeMatrix,
		});
	}

	return references;
}

export function loadModelMatrixFile(args: {
	modelMatrixPath: string;
	workDir: string;
	source?: string;
	fs?: ModelMatrixLoadFileSystem;
}): LoadedModelMatrixDocument {
	const rawPath = String(args.modelMatrixPath || "").trim();
	const resolvedPath = resolveModelMatrixPath(rawPath, args.workDir);
	const source = String(args.source || `model_matrix=${JSON.stringify(rawPath)}`).trim();
	const fileSystem = args.fs || DEFAULT_FS;

	let sourceText = "";
	try {
		sourceText = fileSystem.readFileSync(resolvedPath, "utf-8");
	} catch (error) {
		const isMissing = isErrnoException(error) && error.code === "ENOENT";
		const code = isMissing
			? MODEL_MATRIX_LOAD_ERROR_CODES.FILE_MISSING
			: MODEL_MATRIX_LOAD_ERROR_CODES.FILE_UNREADABLE;
		throw new ModelMatrixLoadError({
			code,
			rawPath,
			resolvedPath,
			source,
			causeValue: error,
			message: formatModelMatrixLoadErrorMessage({
				code,
				source,
				resolvedPath,
				details: `unable to read model_matrix file: ${String(error instanceof Error ? error.message : error)}`,
			}),
		});
	}

	let jsonValue: unknown;
	try {
		jsonValue = JSON.parse(sourceText);
	} catch (error) {
		const code = MODEL_MATRIX_LOAD_ERROR_CODES.JSON_INVALID;
		throw new ModelMatrixLoadError({
			code,
			rawPath,
			resolvedPath,
			source,
			causeValue: error,
			message: formatModelMatrixLoadErrorMessage({
				code,
				source,
				resolvedPath,
				details: `invalid JSON: ${String(error instanceof Error ? error.message : error)}`,
			}),
		});
	}

	try {
		const document = parseModelMatrixDocument(jsonValue, {
			source: `${resolvedPath} (${source})`,
		});
		return {
			rawPath,
			resolvedPath,
			source,
			document,
		};
	} catch (error) {
		if (error instanceof ModelMatrixValidationError) {
			const code = MODEL_MATRIX_LOAD_ERROR_CODES.SCHEMA_INVALID;
			throw new ModelMatrixLoadError({
				code,
				rawPath,
				resolvedPath,
				source,
				causeValue: error,
				validationIssues: error.issues,
				message: formatModelMatrixLoadErrorMessage({
					code,
					source,
					resolvedPath,
					details: error.message,
				}),
			});
		}
		throw error;
	}
}

export function loadAndValidateModelMatricesForGraph(args: {
	graph: Graph;
	workDir: string;
	fs?: ModelMatrixLoadFileSystem;
}): LoadedModelMatrixDocument[] {
	const references = collectModelMatrixReferences(args.graph);
	if (references.length === 0) {
		return [];
	}

	const loadedByPath = new Set<string>();
	const loadedDocuments: LoadedModelMatrixDocument[] = [];
	for (const reference of references) {
		const resolvedPath = resolveModelMatrixPath(reference.rawPath, args.workDir);
		if (loadedByPath.has(resolvedPath)) {
			continue;
		}
		const source = formatReferenceSource(reference);
		const loaded = loadModelMatrixFile({
			modelMatrixPath: reference.rawPath,
			workDir: args.workDir,
			source,
			fs: args.fs,
		});
		loadedDocuments.push(loaded);
		loadedByPath.add(resolvedPath);
	}
	return loadedDocuments;
}

function formatReferenceSource(reference: ModelMatrixReference): string {
	if (reference.scope === "graph") {
		return `graph model_matrix=${JSON.stringify(reference.rawPath)}`;
	}
	return `node ${JSON.stringify(reference.nodeId || "")} model_matrix=${JSON.stringify(reference.rawPath)}`;
}

function formatModelMatrixLoadErrorMessage(args: {
	code: ModelMatrixLoadErrorCode;
	source: string;
	resolvedPath: string;
	details: string;
}): string {
	return `[model-matrix:${args.code}] ${args.source} (${JSON.stringify(args.resolvedPath)}): ${args.details}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
