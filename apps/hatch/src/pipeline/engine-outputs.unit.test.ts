import { describe, expect, it } from "vitest";

import { parseOutputsMapping, extractNamedOutputs } from "./engine-outputs.js";

describe("parseOutputsMapping", () => {
	it("parses simple comma-separated keys", () => {
		const result = parseOutputsMapping("key1,key2,key3");
		expect(result).toEqual([
			{ contextKey: "key1", jsonField: "key1" },
			{ contextKey: "key2", jsonField: "key2" },
			{ contextKey: "key3", jsonField: "key3" },
		]);
	});

	it("parses colon-mapped keys (context_key:json_field)", () => {
		const result = parseOutputsMapping("release_report_issue_url:issue_url");
		expect(result).toEqual([
			{ contextKey: "release_report_issue_url", jsonField: "issue_url" },
		]);
	});

	it("handles mixed simple and mapped keys", () => {
		const result = parseOutputsMapping("delivery_decision,report_url:issue_url,warnings");
		expect(result).toEqual([
			{ contextKey: "delivery_decision", jsonField: "delivery_decision" },
			{ contextKey: "report_url", jsonField: "issue_url" },
			{ contextKey: "warnings", jsonField: "warnings" },
		]);
	});

	it("handles whitespace around entries", () => {
		const result = parseOutputsMapping("  key1 , ctx:json , key2  ");
		expect(result).toEqual([
			{ contextKey: "key1", jsonField: "key1" },
			{ contextKey: "ctx", jsonField: "json" },
			{ contextKey: "key2", jsonField: "key2" },
		]);
	});

	it("filters empty entries", () => {
		const result = parseOutputsMapping(",key1,,key2,");
		expect(result).toEqual([
			{ contextKey: "key1", jsonField: "key1" },
			{ contextKey: "key2", jsonField: "key2" },
		]);
	});
});

describe("extractNamedOutputs", () => {
	it("extracts simple keys from JSON output", () => {
		const output = JSON.stringify({ status: "published", issue_url: "https://example.com/1" });
		const result = extractNamedOutputs("status,issue_url", output);
		expect(Object.fromEntries(result)).toEqual({
			status: "published",
			issue_url: "https://example.com/1",
		});
	});

	it("extracts mapped keys using colon syntax", () => {
		const output = JSON.stringify({
			ok: true,
			status: "published",
			issue_url: "https://github.com/recallnet/astrochicken/issues/2412",
		});
		const result = extractNamedOutputs("release_report_issue_url:issue_url", output);
		expect(Object.fromEntries(result)).toEqual({
			release_report_issue_url: "https://github.com/recallnet/astrochicken/issues/2412",
		});
	});

	it("handles mixed simple and mapped keys", () => {
		const output = JSON.stringify({
			delivery_decision: "slack_and_issue",
			issue_url: "https://example.com/42",
			warnings: ["w1"],
		});
		const result = extractNamedOutputs("delivery_decision,report_url:issue_url,warnings", output);
		expect(Object.fromEntries(result)).toEqual({
			delivery_decision: "slack_and_issue",
			report_url: "https://example.com/42",
			warnings: '["w1"]',
		});
	});

	it("skips fields not present in JSON output", () => {
		const output = JSON.stringify({ status: "ok" });
		const result = extractNamedOutputs("status,missing_field", output);
		expect(Object.fromEntries(result)).toEqual({ status: "ok" });
	});

	it("stringifies non-string values", () => {
		const output = JSON.stringify({ count: 42, nested: { a: 1 } });
		const result = extractNamedOutputs("count,nested", output);
		expect(Object.fromEntries(result)).toEqual({
			count: "42",
			nested: '{"a":1}',
		});
	});

	it("falls back to storing raw output for non-JSON with single key", () => {
		const result = extractNamedOutputs("raw_output", "not json");
		expect(Object.fromEntries(result)).toEqual({ raw_output: "not json" });
	});

	it("falls back to storing raw output for non-JSON with single mapped key", () => {
		const result = extractNamedOutputs("ctx_key:json_field", "not json");
		expect(Object.fromEntries(result)).toEqual({ ctx_key: "not json" });
	});

	it("returns empty map for non-JSON with multiple keys", () => {
		const result = extractNamedOutputs("key1,key2", "not json");
		expect(result.size).toBe(0);
	});

	// Regression: LLM returns raw array instead of wrapper object.
	// Without this fallback, approved_features is silently lost and
	// downstream fan_out nodes get empty input, failing every decomposition.
	it("assigns raw array to features-like mapping when LLM returns array instead of object", () => {
		const features = [{ id: "F-1", name: "feature one" }, { id: "F-2", name: "feature two" }];
		const result = extractNamedOutputs(
			"approved,approved_features,review_notes",
			JSON.stringify(features),
		);
		expect(result.has("approved_features")).toBe(true);
		expect(JSON.parse(result.get("approved_features")!)).toEqual(features);
	});

	it("assigns raw array to single mapping when there is only one output key", () => {
		const items = [1, 2, 3];
		const result = extractNamedOutputs("items", JSON.stringify(items));
		expect(result.has("items")).toBe(true);
		expect(JSON.parse(result.get("items")!)).toEqual(items);
	});

	it("does not assign raw array when no mapping matches features pattern and multiple keys exist", () => {
		const items = [1, 2, 3];
		const result = extractNamedOutputs("approved,review_notes", JSON.stringify(items));
		expect(result.size).toBe(0);
	});
});
