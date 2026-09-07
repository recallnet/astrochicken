import { describe, it, expect } from "vitest";
import { ConditionExpr, parseCondition } from "./condition.js";

describe("parseCondition", () => {
	it("returns null for empty string", () => {
		expect(parseCondition("")).toBeNull();
	});

	it("returns null for whitespace-only string", () => {
		expect(parseCondition("   ")).toBeNull();
	});

	it("parses single equality clause", () => {
		const expr = parseCondition("status=done");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "status", op: "=", value: "done" },
		]);
	});

	it("parses single inequality clause", () => {
		const expr = parseCondition("count!=0");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "count", op: "!=", value: "0" },
		]);
	});

	it("parses greater than", () => {
		const expr = parseCondition("retries>3");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "retries", op: ">", value: "3" },
		]);
	});

	it("parses less than", () => {
		const expr = parseCondition("score<10");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "score", op: "<", value: "10" },
		]);
	});

	it("parses greater or equal (not as > with value '=3')", () => {
		const expr = parseCondition("retries>=3");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "retries", op: ">=", value: "3" },
		]);
	});

	it("parses less or equal", () => {
		const expr = parseCondition("score<=10");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "score", op: "<=", value: "10" },
		]);
	});

	it("parses bare key as key=true", () => {
		const expr = parseCondition("enabled");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "enabled", op: "=", value: "true" },
		]);
	});

	it("parses multiple clauses joined by &&", () => {
		const expr = parseCondition("status=done && count>0");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toHaveLength(2);
		expect(expr!.clauses[0]).toEqual({
			key: "status",
			op: "=",
			value: "done",
		});
		expect(expr!.clauses[1]).toEqual({
			key: "count",
			op: ">",
			value: "0",
		});
	});

	it("trims whitespace around keys and values", () => {
		const expr = parseCondition(" status = done ");
		expect(expr).not.toBeNull();
		expect(expr!.clauses).toEqual([
			{ key: "status", op: "=", value: "done" },
		]);
	});
});

describe("ConditionExpr.evaluate", () => {
	it("returns true for empty clauses", () => {
		const expr = new ConditionExpr([]);
		expect(expr.evaluate(() => "")).toBe(true);
	});

	it("returns true when equality matches", () => {
		const expr = parseCondition("status=done")!;
		expect(expr.evaluate(() => "done")).toBe(true);
	});

	it("returns false when equality does not match", () => {
		const expr = parseCondition("status=done")!;
		expect(expr.evaluate(() => "pending")).toBe(false);
	});

	it("returns true when inequality matches (values differ)", () => {
		const expr = parseCondition("count!=0")!;
		expect(expr.evaluate(() => "5")).toBe(true);
	});

	it("returns false when inequality does not match (values same)", () => {
		const expr = parseCondition("count!=0")!;
		expect(expr.evaluate(() => "0")).toBe(false);
	});

	it("greater than: 5 > 3 is true", () => {
		const expr = parseCondition("retries>3")!;
		expect(expr.evaluate(() => "5")).toBe(true);
	});

	it("greater than: 3 > 5 is false", () => {
		const expr = parseCondition("retries>5")!;
		expect(expr.evaluate(() => "3")).toBe(false);
	});

	it("less than: 3 < 5 is true", () => {
		const expr = parseCondition("score<5")!;
		expect(expr.evaluate(() => "3")).toBe(true);
	});

	it("greater or equal: 3 >= 3 is true", () => {
		const expr = parseCondition("retries>=3")!;
		expect(expr.evaluate(() => "3")).toBe(true);
	});

	it("less or equal: 3 <= 3 is true", () => {
		const expr = parseCondition("score<=3")!;
		expect(expr.evaluate(() => "3")).toBe(true);
	});

	it("returns false for non-numeric comparison", () => {
		const expr = parseCondition("score>3")!;
		expect(expr.evaluate(() => "abc")).toBe(false);
	});

	it("returns true when all clauses in AND are true", () => {
		const expr = parseCondition("status=done && count>0")!;
		expect(
			expr.evaluate((key) => (key === "status" ? "done" : "5")),
		).toBe(true);
	});

	it("returns false when one clause in AND is false", () => {
		const expr = parseCondition("status=done && count>0")!;
		expect(
			expr.evaluate((key) => (key === "status" ? "pending" : "5")),
		).toBe(false);
	});

	it("trims lookup value before comparison", () => {
		const expr = parseCondition("status=done")!;
		expect(expr.evaluate(() => " done ")).toBe(true);
	});
});

describe("ConditionExpr.toString", () => {
	it("serializes clauses back to string with && separator", () => {
		const expr = parseCondition("status=done && count>0")!;
		expect(expr.toString()).toBe("status=done && count>0");
	});

	it("serializes single clause without separator", () => {
		const expr = parseCondition("status=done")!;
		expect(expr.toString()).toBe("status=done");
	});

	it("serializes empty clauses to empty string", () => {
		const expr = new ConditionExpr([]);
		expect(expr.toString()).toBe("");
	});
});
