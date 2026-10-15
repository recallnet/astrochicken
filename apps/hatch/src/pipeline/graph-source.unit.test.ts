import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadGraphSource } from "./graph-source.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workflowModule(name: string) {
	return {
		schemaVersion: "workflow_source_module/v1",
		workflowId: name,
		familyId: "loader_regression",
		title: name,
		sourcePath: `${name}.workflow-source.mjs`,
		runtimeGraphPath: `${name}.dot`,
		jsonSchemaOutputPath: "workflow-source.schema.json",
		sourceMap: { graphName: name, nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }, { sourceNodeId: "done", runtimeNodeId: "done" }] },
		invariants: { mustPreserve: ["node.id"], mayNormalize: ["whitespace"] },
		nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
		edges: [{ from: "start", to: "done" }],
	};
}

function temporaryModule(source: string): string {
	const directory = mkdtempSync(join(tmpdir(), "hatch-workflow-loader-"));
	temporaryDirectories.push(directory);
	const file = join(directory, "example.workflow-source.mjs");
	writeFileSync(file, source);
	return file;
}

describe("typed workflow module loading", () => {
	it("loads an inline authored module without requiring a JSON sidecar", () => {
		const file = temporaryModule(`const name = "inline_workflow"; export const WORKFLOW_SOURCE_MODULE = { ...${JSON.stringify(workflowModule("inline_workflow"))}, title: name };`);
		const result = loadGraphSource(file, ".");
		expect(result.sourceKind).toBe("workflow_source");
		expect(result.sourceText).toContain("digraph inline_workflow");
	});

	it("uses the module export rather than a stale sidecar", () => {
		const file = temporaryModule(`export default ${JSON.stringify(workflowModule("authored_workflow"))};`);
		writeFileSync(file.replace(".mjs", ".data.json"), JSON.stringify(workflowModule("stale_sidecar")));
		expect(loadGraphSource(file, ".").sourceText).toContain("digraph authored_workflow");
	});

	it("validates authored exports instead of accepting invalid documents", () => {
		const file = temporaryModule("export const WORKFLOW_SOURCE_MODULE = { workflowId: 'invalid' };");
		expect(() => loadGraphSource(file, ".")).toThrow();
	});

	it.each(["coding", "merge", "product-judge"])("loads installed @hatch/capability-%s workflow exports", (capability) => {
		const names = { coding: "issue_execute_item", merge: "merge_item", "product-judge": "product_judge" };
		const name = names[capability as keyof typeof names];
		const result = loadGraphSource(`@hatch/capability-${capability}/workflows/${name}/${name}.workflow-source.mjs`, ".");
		expect(result.sourceKind).toBe("workflow_source");
		expect(result.sourceText).toContain(`digraph ${name}`);
	});
});
