import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import {
	exportWorkflowSourceDocument,
} from "@hatch/factory-core/workflow-source-registry";
import {
	renderWorkflowSourceModuleToDot,
} from "@hatch/factory-core/workflow-ir-registry";

const require = createRequire(import.meta.url);

function trim(value = ""): string {
	return String(value || "").trim();
}

function isWorkflowSourceModulePath(filePath = ""): boolean {
	return trim(filePath).endsWith(".workflow-source.mjs");
}

function deriveWorkflowSourceDataPath(modulePath = ""): string {
	return trim(modulePath).replace(/\.workflow-source\.mjs$/u, ".workflow-source.data.json");
}

/**
 * Resolve a graph/workflow path.
 * - `@scope/pkg/subpath` → resolves via require.resolve
 * - absolute paths → used as-is
 * - `~` prefix → expanded to $HOME
 * - relative paths → resolved against workDir
 */
export function resolveGraphPath(raw: string, workDir: string): string {
	if (raw.startsWith("@")) {
		return require.resolve(raw);
	}
	if (raw.startsWith("/")) return raw;
	if (raw.startsWith("~")) {
		return raw.replace("~", process.env["HOME"] || "~");
	}
	return resolve(workDir || ".", raw);
}

export interface LoadedGraphSource {
	resolvedPath: string;
	sourceText: string;
	sourceKind: "dot" | "workflow_source";
}

export function loadGraphSource(raw: string, workDir: string): LoadedGraphSource {
	const resolvedPath = resolveGraphPath(raw, workDir);
	if (!isWorkflowSourceModulePath(resolvedPath)) {
		return {
			resolvedPath,
			sourceText: readFileSync(resolvedPath, "utf8"),
			sourceKind: "dot",
		};
	}

	const workflowSourceDataPath = deriveWorkflowSourceDataPath(resolvedPath);
	const workflowSourceData = JSON.parse(readFileSync(workflowSourceDataPath, "utf8"));
	const workflowSourceDocument = exportWorkflowSourceDocument(workflowSourceData);

	return {
		resolvedPath,
		sourceText: renderWorkflowSourceModuleToDot(workflowSourceDocument, { hostPath: resolvedPath }),
		sourceKind: "workflow_source",
	};
}

export function graphWorkDirForResolvedSource(resolvedPath: string, fallback = "."): string {
	return dirname(trim(resolvedPath) || trim(fallback) || ".");
}
