import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nodeClass, nodeHandlerType, nodeLLMModel, nodeLLMProvider, nodeTrustRole, type Graph } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

function loadResolvedGraph(graphPath: string): Graph {
	const absoluteGraphPath = join(REPO_ROOT, graphPath);
	const parsed = parseWithAst(readFileSync(absoluteGraphPath, "utf8"));
	applyGraphStylesheetImports({
		graph: parsed.graph,
		graphFile: absoluteGraphPath,
		stylesheetImports: parsed.stylesheetImports,
		repoRootPath: REPO_ROOT,
	});
	return parsed.graph;
}

describe("Stage 1 release_narrator role rename contract", () => {
	it("preserves runtime semantics for the renamed release narrator node", () => {
		const graph = loadResolvedGraph("docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot");
		const node = graph.nodes["release_narrator"];

		expect(node, "release_report_flow.dot::release_narrator must exist").toBeTruthy();
		expect(nodeClass(node)).toBe("release_narrator");
		expect(nodeHandlerType(node)).toBe("codergen");
		expect(nodeLLMProvider(node)).toBe("");
		expect(nodeLLMModel(node)).toBe("");
		expect(nodeTrustRole(node)).toBe("unknown");
		expect(String(node.attrs.skill_id || "")).toBe("supervisor.release_narrator");
		expect(String(node.attrs.session_id || "")).toBe("supervisor-${factory_id}");
	});

	it("keeps the mothership role bundle semantics aligned with the prior knowledge_worker role", () => {
		const stylesheet = readFileSync(join(REPO_ROOT, "factories/mothership/roles.stylesheet"), "utf8");

		expect(stylesheet).toMatch(/\.release_narrator\s*\{/);
		expect(stylesheet).toMatch(/llm_provider = "openrouter"/);
		expect(stylesheet).toContain('llm_model = "google/gemini-3.1-pro-preview"');
		expect(stylesheet).toContain('trust_role = "mothership.local.codergen"');
	});
});
