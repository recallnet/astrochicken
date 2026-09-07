import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IntentLoadError, findRepoRoot, formatIntentLoadIssues, loadIntentRegistry } from "./loader.js";
import {
	INTENT_BOUNDARY_SCHEMA,
	INTENT_SCHEMA_VERSION,
	IntentSchemaError,
	formatIntentSchemaIssues,
	intentDocumentSchema,
	parseIntentDocument,
	validateIntentDocument,
} from "./schema.js";

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("intent loader and schema helpers", () => {
	let root = "";

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("loads intent registries, formats load issues, and finds the repo root", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-intent-loader-"));
		mkdirSync(join(root, ".git"));
		const intentRoot = join(root, "context", "intent");
		writeJson(join(intentRoot, "quality.intent.json"), {
			schema: INTENT_SCHEMA_VERSION,
			id: "quality",
			title: "Quality",
			summary: "Ship deterministic QA gates.",
			goals: ["ratchet coverage"],
			profiles: {
				operator: {
					audience: "operators",
					acceptance_criteria: ["clear operator output"],
				},
			},
		});

		const registry = loadIntentRegistry({ rootDir: root });
		expect(registry?.intents.quality?.profiles.default.summary).toBe("Ship deterministic QA gates.");
		expect(registry?.intents.quality?.profiles.operator.audience).toBe("operators");
		expect(findRepoRoot(join(root, "context", "intent"))).toBe(root);
		expect(
			formatIntentLoadIssues([{ path: "one.intent.json", message: "invalid JSON" }]),
		).toBe("- one.intent.json: invalid JSON");
	});

	it("validates intent schema and raises typed schema/load errors", () => {
		expect(INTENT_BOUNDARY_SCHEMA.version).toBe(INTENT_SCHEMA_VERSION);
		expect(intentDocumentSchema.safeParse({
			schema: INTENT_SCHEMA_VERSION,
			id: "intent",
			title: "Title",
			summary: "Summary",
		}).success).toBe(true);

		const issues = validateIntentDocument({
			schema: "wrong",
			id: "",
			title: "ok",
			summary: "ok",
			extra: true,
			profiles: {
				bad: {
					goals: ["x", 2],
					extra: "nope",
				},
			},
		});
		expect(issues.map((issue) => issue.path)).toContain("extra");
		expect(issues.map((issue) => issue.path)).toContain("schema");
		expect(issues.map((issue) => issue.path)).toContain("id");
		expect(issues.map((issue) => issue.path)).toContain("profiles.bad.extra");
		expect(formatIntentSchemaIssues(issues)).toContain('schema must be "hatch.intent.v1"');

		expect(() => parseIntentDocument({ schema: INTENT_SCHEMA_VERSION, id: "x" })).toThrow(IntentSchemaError);

		root = mkdtempSync(join(tmpdir(), "hatch-intent-loader-error-"));
		expect(() => loadIntentRegistry({ rootDir: root, intentPaths: ["missing"] })).toThrow(IntentLoadError);
		try {
			loadIntentRegistry({ rootDir: root, intentPaths: ["missing"] });
			throw new Error("expected intent load to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(IntentLoadError);
			expect(String(error)).toContain("intent path not found");
		}
	});
});
