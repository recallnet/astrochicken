import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

interface QueryContract {
	query_id: string;
	description: string;
	filter: Record<string, unknown>;
	group_by: string[];
	metrics: string[];
}

const CONTRACT_PATH = join(import.meta.dirname, "../../../../docs/contracts/langfuse-benchmark-queries.json");

const REQUIRED_QUERY_IDS = [
	"cost_per_skill",
	"cost_per_work_unit",
	"first_pass_rate",
	"retry_by_failure_class",
	"model_utilization",
	"cross_factory_benchmark",
	"prompt_version_comparison",
	"model_comparison",
	"latency_per_job",
] as const;

function loadQueryContract(): QueryContract[] {
	return JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as QueryContract[];
}

describe("langfuse benchmark query contract", () => {
	it("contains exactly the required deterministic query_id set", () => {
		const entries = loadQueryContract();
		expect(Array.isArray(entries)).toBe(true);
		expect(entries.map((query) => query.query_id)).toEqual(REQUIRED_QUERY_IDS);
	});

	it("enforces required shape for each query entry", () => {
		const entries = loadQueryContract();
		for (const query of entries) {
			expect(typeof query.query_id).toBe("string");
			expect(query.query_id.length).toBeGreaterThan(0);
			expect(typeof query.description).toBe("string");
			expect(query.description.length).toBeGreaterThan(0);
			expect(typeof query.filter).toBe("object");
			expect(Array.isArray(query.filter)).toBe(false);
			expect(Array.isArray(query.group_by)).toBe(true);
			expect(query.group_by.length).toBeGreaterThan(0);
			expect(query.group_by.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
			expect(Array.isArray(query.metrics)).toBe(true);
			expect(query.metrics.length).toBeGreaterThan(0);
			expect(query.metrics.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
		}
	});
});
