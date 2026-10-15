import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

const require = createRequire(import.meta.url);

function trim(value = ""): string {
	return String(value || "").trim();
}

function isWorkflowSourceModulePath(filePath = ""): boolean {
	return trim(filePath).endsWith(".workflow-source.mjs");
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
			sourceText: loadGraphSemanticsText(resolvedPath),
			sourceKind: "dot",
		};
	}


	return {
		resolvedPath,
		sourceText: loadGraphSemanticsText(resolvedPath),
		sourceKind: "workflow_source",
	};
}

export function graphWorkDirForResolvedSource(resolvedPath: string, fallback = "."): string {
	return dirname(trim(resolvedPath) || trim(fallback) || ".");
}
