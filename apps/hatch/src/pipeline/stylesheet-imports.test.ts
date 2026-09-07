import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseWithAst } from "./parse.js";
import {
	CircularStylesheetImportError,
	MissingStylesheetImportError,
	StylesheetImportParseError,
	applyGraphStylesheetImports,
	loadStylesheetImports,
} from "./stylesheet-imports.js";

describe("stylesheet imports", () => {
	it("resolves imports relative to graph file and falls back to repo root", () => {
		const root = mkdtempSync(join(tmpdir(), "stylesheet-imports-"));
		const graphDir = join(root, "graphs", "milestone");
		const localStylesDir = join(graphDir, "styles");
		const sharedStylesDir = join(root, "shared", "styles");
		mkdirSync(localStylesDir, { recursive: true });
		mkdirSync(sharedStylesDir, { recursive: true });

		writeFileSync(join(localStylesDir, "local.stylesheet"), `.coder { reasoning_effort = "medium" }\n`, "utf-8");
		writeFileSync(join(sharedStylesDir, "root.stylesheet"), `.coder { llm_model = "root-model" }\n`, "utf-8");

		const imported = loadStylesheetImports({
			graphFile: join(graphDir, "pipeline.dot"),
			imports: ["styles/local.stylesheet", "shared/styles/root.stylesheet"],
			repoRootPath: root,
		});

		expect(imported.rules).toHaveLength(2);
		expect(imported.rules[0]?.properties["reasoning_effort"]).toBe("medium");
		expect(imported.rules[1]?.properties["llm_model"]).toBe("root-model");
	});

	it("merges imports before inline model_stylesheet so inline rules win", () => {
		const root = mkdtempSync(join(tmpdir(), "stylesheet-merge-"));
		const graphDir = join(root, "graphs");
		mkdirSync(join(graphDir, "styles"), { recursive: true });

		writeFileSync(
			join(graphDir, "styles", "defaults.stylesheet"),
			`.coder { llm_model = "imported-model"; label = "Imported label" }\n`,
			"utf-8",
		);

		const parsed = parseWithAst(`
			@import "styles/defaults.stylesheet"
			digraph sample {
				model_stylesheet=".coder { llm_model = \\\"inline-model\\\" }"
				start [shape=Mdiamond]
				done [shape=Msquare]
				build [class="coder" label="Explicit label"]
				start -> build -> done
			}
		`);

		applyGraphStylesheetImports({
			graph: parsed.graph,
			graphFile: join(graphDir, "pipeline.dot"),
			stylesheetImports: parsed.stylesheetImports,
			repoRootPath: root,
		});

		expect(parsed.graph.nodes["build"]?.attrs["llm_model"]).toBe("inline-model");
		expect(parsed.graph.nodes["build"]?.attrs["label"]).toBe("Explicit label");
	});

	it("applies mothership role imports with inherited contracts and inline overrides", () => {
		const repoRootPath = join(import.meta.dirname, "../../../../");

		const reviewerGraphFile = join(repoRootPath, "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot");
		const reviewerParsed = parseWithAst(readFileSync(reviewerGraphFile, "utf-8"));
		applyGraphStylesheetImports({
			graph: reviewerParsed.graph,
			graphFile: reviewerGraphFile,
			stylesheetImports: reviewerParsed.stylesheetImports,
			repoRootPath,
		});

		const reviewerNode = reviewerParsed.graph.nodes["review"];
		expect(reviewerNode?.attrs["output_format"]).toBe("json");
		expect(reviewerNode?.attrs["outputs"]).toBe("disposition,confidence,recommended_transition,reason_codes,notes,verdict");
		expect(reviewerNode?.attrs["output_key"]).toBe("review_result");
		expect(reviewerNode?.attrs["max_retries"]).toBe("1");
		expect(reviewerNode?.attrs["llm_provider"]).toBe("openrouter");
		expect(reviewerNode?.attrs["llm_model"]).toBe("anthropic/claude-sonnet-4.6");

		const judgeGraphFile = join(repoRootPath, "docs/contracts/workflow-ir/mothership/goal_execute.dot");
		const judgeParsed = parseWithAst(readFileSync(judgeGraphFile, "utf-8"));
		applyGraphStylesheetImports({
			graph: judgeParsed.graph,
			graphFile: judgeGraphFile,
			stylesheetImports: judgeParsed.stylesheetImports,
			repoRootPath,
		});

		const judgeNode = judgeParsed.graph.nodes["judge"];
		expect(judgeNode?.attrs["judge_context_scope"]).toBe("identity");
		expect(judgeNode?.attrs["output_format"]).toBe("json");
		expect(judgeNode?.attrs["output_key"]).toBe("judge_result");
		expect(judgeNode?.attrs["llm_provider"]).toBe("openrouter");
		expect(judgeNode?.attrs["llm_model"]).toBe("anthropic/claude-sonnet-4.6");
	});

	it("applies shared strategist role imports with persona-aware class wiring", () => {
		const repoRootPath = join(import.meta.dirname, "../../../../");
		const graphFile = join(repoRootPath, "factories/mothership/graphs/_strategist_stylesheet_contract.dot");

		const parsed = parseWithAst(`
			@import "factories/_shared/roles.stylesheet"
			digraph brainstorm_styles {
				start [shape=Mdiamond]
				done [shape=Msquare]
				red [class="red_strategist"]
				blue [class="blue_strategist" persona="Custom blue persona"]
				start -> red -> blue -> done
			}
		`);

		applyGraphStylesheetImports({
			graph: parsed.graph,
			graphFile,
			stylesheetImports: parsed.stylesheetImports,
			repoRootPath,
		});

		const redNode = parsed.graph.nodes["red"];
		expect(redNode?.attrs["type"]).toBe("agent.kw");
		expect(redNode?.attrs["llm_provider"]).toBe("anthropic");
		expect(redNode?.attrs["llm_model"]).toBe("claude-sonnet-4-6");
		expect(redNode?.attrs["persona"]).toContain("Contrarian product strategist");

		const blueNode = parsed.graph.nodes["blue"];
		expect(blueNode?.attrs["type"]).toBe("agent.kw");
		expect(blueNode?.attrs["llm_provider"]).toBe("anthropic");
		expect(blueNode?.attrs["llm_model"]).toBe("claude-opus-4-6");
		expect(blueNode?.attrs["persona"]).toBe("Custom blue persona");
	});

	it("throws deterministic missing import error with attempted paths", () => {
		const root = mkdtempSync(join(tmpdir(), "stylesheet-missing-"));
		const graphFile = join(root, "graphs", "pipeline.dot");
		mkdirSync(join(root, "graphs"), { recursive: true });

		expect(() => loadStylesheetImports({
			graphFile,
			imports: ["styles/does-not-exist.stylesheet"],
			repoRootPath: root,
		})).toThrowError(MissingStylesheetImportError);

		try {
			loadStylesheetImports({
				graphFile,
				imports: ["styles/does-not-exist.stylesheet"],
				repoRootPath: root,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(MissingStylesheetImportError);
			const typed = error as MissingStylesheetImportError;
			expect(typed.details.attemptedPaths.length).toBeGreaterThan(0);
			expect(typed.message).toContain("stylesheet import 1/1");
		}
	});

	it("detects circular stylesheet imports with explicit cycle chain", () => {
		const root = mkdtempSync(join(tmpdir(), "stylesheet-cycle-"));
		const graphDir = join(root, "graphs");
		const stylesDir = join(graphDir, "styles");
		mkdirSync(stylesDir, { recursive: true });

		writeFileSync(join(stylesDir, "a.stylesheet"), `@import "b.stylesheet"\n.coder { llm_model = "a" }\n`, "utf-8");
		writeFileSync(join(stylesDir, "b.stylesheet"), `@import "a.stylesheet"\n.coder { llm_model = "b" }\n`, "utf-8");

		expect(() => loadStylesheetImports({
			graphFile: join(graphDir, "pipeline.dot"),
			imports: ["styles/a.stylesheet"],
			repoRootPath: root,
		})).toThrowError(CircularStylesheetImportError);
	});

	it("fails parse for malformed imported stylesheet syntax", () => {
		const root = mkdtempSync(join(tmpdir(), "stylesheet-parse-"));
		const graphDir = join(root, "graphs");
		const stylesDir = join(graphDir, "styles");
		mkdirSync(stylesDir, { recursive: true });

		writeFileSync(join(stylesDir, "broken.stylesheet"), `.coder { llm_model = "x"\n`, "utf-8");

		expect(() => loadStylesheetImports({
			graphFile: join(graphDir, "pipeline.dot"),
			imports: ["styles/broken.stylesheet"],
			repoRootPath: root,
		})).toThrowError(StylesheetImportParseError);
	});
});
