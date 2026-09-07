import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	parseComplexityEstimateArgs,
	loadComplexityInput,
	COMPLEXITY_ESTIMATE_USAGE,
} from "./complexity-estimate-args.js";

describe("parseComplexityEstimateArgs", () => {
	it("accepts inline input positional", () => {
		const parsed = parseComplexityEstimateArgs(['{"issue_title":"x"}']);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.input).toBe('{"issue_title":"x"}');
	});

	it("accepts explicit flags and numbers", () => {
		const parsed = parseComplexityEstimateArgs([
			"--issue-title",
			"Feature",
			"--estimated-lines-added",
			"22",
			"--estimated-lines-deleted",
			"3",
			"--dependency-count",
			"2",
			"--dependencies",
			"[#12,#13]",
			"--blocked-by",
			"#14,#15",
			"--blocks",
			"#16",
		]);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.issueTitle).toBe("Feature");
		expect(parsed.value.estimatedLinesAdded).toBe(22);
		expect(parsed.value.estimatedLinesDeleted).toBe(3);
		expect(parsed.value.dependencyCount).toBe(2);
		expect(parsed.value.dependencies).toBe("[#12,#13]");
		expect(parsed.value.blockedBy).toBe("#14,#15");
		expect(parsed.value.blocks).toBe("#16");
	});

	it("rejects unknown flags", () => {
		const parsed = parseComplexityEstimateArgs(["--bogus"]);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.usage).toBe(COMPLEXITY_ESTIMATE_USAGE);
		expect(parsed.error.message).toContain("unknown option");
	});

	it("rejects non numeric values", () => {
		const parsed = parseComplexityEstimateArgs(["--estimated-lines-added", "abc"]);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.message).toContain("expects a number");
	});
});

describe("loadComplexityInput", () => {
	it("merges file input + flag overrides", () => {
		const dir = mkdtempSync(join(tmpdir(), "hatch-complexity-input-"));
		const file = join(dir, "input.json");
		writeFileSync(
			file,
			JSON.stringify({
				issue_title: "From file",
				estimated_lines_added: 5,
				changed_files: ["a.ts"],
			}),
		);

		const input = loadComplexityInput({
			input: file,
			issueTitle: "From flag",
			changedFiles: "[\"x.ts\",\"y.ts\"]",
			dependencyCount: 3,
		}) as Record<string, unknown>;

		expect(input.issue_title).toBe("From flag");
		expect(input.estimated_lines_added).toBe(5);
		expect(input.changed_files).toEqual(["x.ts", "y.ts"]);
		expect(input.dependency_count).toBe(3);
	});

	it("parses csv changed files", () => {
		const input = loadComplexityInput({ changedFiles: "a.ts, b.ts" }) as Record<string, unknown>;
		expect(input.changed_files).toEqual(["a.ts", "b.ts"]);
	});

	it("parses relationship arrays from flags", () => {
		const input = loadComplexityInput({
			dependencies: "#11,#12",
			blockedBy: "[\"#13\",\"#14\"]",
			blocks: "#15",
		}) as Record<string, unknown>;
		expect(input.dependencies).toEqual(["#11", "#12"]);
		expect(input.blocked_by).toEqual(["#13", "#14"]);
		expect(input.blocks).toEqual(["#15"]);
	});
});
