import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { graphWorkDirForResolvedSource, loadGraphSource, resolveGraphPath } from "../graph-source.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../..", import.meta.url)));

describe("resolveGraphPath", () => {
	it("resolves @hatch/capability-coding graph exports", () => {
		const result = resolveGraphPath("packages/capability-coding/workflows/issue_execute_item/issue_execute_item.workflow-source.mjs", "/tmp");
		expect(result).toMatch(/packages\/capability-coding\/workflows\/issue_execute_item\/issue_execute_item\.workflow-source\.mjs$/);
		expect(result.startsWith("/")).toBe(true);
	});

	it("resolves @hatch/capability-product-judge graph exports", () => {
		const result = resolveGraphPath("packages/capability-product-judge/workflows/product_judge/product_judge.workflow-source.mjs", "/tmp");
		expect(result).toMatch(/packages\/capability-product-judge\/workflows\/product_judge\/product_judge\.workflow-source\.mjs$/);
		expect(result.startsWith("/")).toBe(true);
	});

	it("resolves workflow source modules as normal repo-relative paths", () => {
		const result = resolveGraphPath("packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs", "/tmp");
		expect(result).toMatch(/packages\/capability-software-development\/workflows\/goal_execute\/goal_execute\.workflow-source\.mjs$/);
	});

	it("returns absolute paths unchanged", () => {
		expect(resolveGraphPath("/some/absolute/path.dot", "/workdir")).toBe("/some/absolute/path.dot");
	});

	it("expands ~ to HOME", () => {
		const home = process.env["HOME"] || "~";
		expect(resolveGraphPath("~/graphs/test.dot", "/workdir")).toBe(`${home}/graphs/test.dot`);
	});

	it("resolves relative paths against workDir", () => {
		const result = resolveGraphPath("graphs/test.dot", "/my/workdir");
		expect(result).toBe(resolve("/my/workdir", "graphs/test.dot"));
	});

	it("throws for unresolvable @ packages", () => {
		expect(() => resolveGraphPath("@nonexistent/package/foo.dot", "/tmp")).toThrow();
	});

	it("loads workflow source modules as rendered DOT", () => {
		const loaded = loadGraphSource("packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs", repoRoot);
		expect(loaded.sourceKind).toBe("workflow_source");
		expect(loaded.sourceText).toContain("digraph release_report_flow");
		expect(loaded.sourceText).toContain("publish_release_report [");
	});

	it("loads raw dot files unchanged", () => {
		const path = resolveGraphPath("factories/mothership/graphs/daily_release_report.dot", repoRoot);
		const loaded = loadGraphSource("factories/mothership/graphs/daily_release_report.dot", repoRoot);
		expect(loaded.sourceKind).toBe("dot");
		expect(loaded.sourceText).toBe(readFileSync(path, "utf8"));
	});

	it("derives the work dir from a resolved graph source path", () => {
		expect(
			graphWorkDirForResolvedSource(
				resolve(repoRoot, "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs"),
				"/fallback",
			),
		).toBe(resolve(repoRoot, "packages/capability-software-development/workflows/goal_execute"));
		expect(graphWorkDirForResolvedSource("", "/fallback")).toBe("/");
	});
});
