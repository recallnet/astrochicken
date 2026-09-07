import { describe, expect, it } from "vitest";

import {
	graphComplexityClass,
	nodeComplexityClass,
	parseComplexityClass,
} from "./graph.js";
import { parse } from "./parse.js";
import { formatValidationError, hasValidationErrors, validate } from "./validate.js";

describe("complexity class graph metadata accessors", () => {
	it("reads graph complexity_class with normalization", () => {
		const graph = parse(`
	digraph graph_complexity_attr {
		complexity_class = " HIGH "
		start [shape=Mdiamond]
		done [shape=Msquare]
		start -> done
	}
		`);

		expect(graphComplexityClass(graph)).toBe("high");
		expect(parseComplexityClass(" medium ")).toBe("medium");
		expect(parseComplexityClass("unknown")).toBe("");
	});

	it("reads node complexity_class (and legacy complexity alias)", () => {
		const graph = parse(`
	digraph node_complexity_attr {
		start [shape=Mdiamond]
		n1 [type="tool" prompt="estimate" complexity_class="low"]
		n2 [type="tool" prompt="estimate" complexity="medium"]
		n3 [type="tool" prompt="estimate" complexity_class="invalid"]
		done [shape=Msquare]

		start -> n1 -> n2 -> n3 -> done
	}
		`);

		expect(nodeComplexityClass(graph.nodes.n1)).toBe("low");
		expect(nodeComplexityClass(graph.nodes.n2)).toBe("medium");
		expect(nodeComplexityClass(graph.nodes.n3)).toBe("");
	});
});

describe("complexity estimator provenance validation", () => {
	it("warns when edge condition explicitly references complexity_class without upstream estimator", () => {
		const graph = parse(`
	digraph missing_estimator {
		start [shape=Mdiamond]
		route [shape=diamond]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> route
		route -> fast [condition="complexity_class=low"]
		route -> full [condition="complexity_class!=low"]
	}
		`);

		const errors = validate(graph);
		const warnings = errors.filter((entry) => entry.rule === "complexity_estimator_provenance");

		expect(warnings.length).toBe(2);
		expect(warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					nodeId: "route",
					severity: "warning",
					message:
						"edge route -> fast uses condition \"complexity_class=low\" on complexity routing key (complexity_class|complexity) but no upstream estimator node is reachable from \"route\". An estimator node must precede this complexity-based condition and emit complexity_class (or legacy complexity) via output_key or outputs so routing has provenance.",
				}),
			]),
		);
		expect(hasValidationErrors(errors)).toBe(false);
	});

	it("warns when upstream node is non-tool even if it declares complexity output metadata", () => {
		const graph = parse(`
	digraph non_tool_metadata_is_not_provenance {
		start [shape=Mdiamond]
		route [shape=diamond output_key="complexity_class"]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> route
		route -> fast [condition="complexity_class=low"]
		route -> full [condition="complexity_class!=low"]
	}
		`);

		const errors = validate(graph);
		const warnings = errors.filter((entry) => entry.rule === "complexity_estimator_provenance");
		expect(warnings.length).toBe(2);
		expect(warnings.every((entry) => entry.nodeId === "route")).toBe(true);
		expect(hasValidationErrors(errors)).toBe(false);
	});

	it("does not warn when source path has upstream estimator output_key", () => {
		const graph = parse(`
	digraph estimator_with_output_key {
		start [shape=Mdiamond]
		estimate [type="tool" prompt="estimate" output_key="complexity_class" governance="reversible"]
		route [shape=diamond]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> estimate -> route
		route -> fast [condition="complexity_class=low"]
		route -> full [condition="complexity_class!=low"]
	}
		`);

		const errors = validate(graph);
		expect(errors.find((entry) => entry.rule === "complexity_estimator_provenance")).toBeUndefined();
		expect(hasValidationErrors(errors)).toBe(false);
	});

	it("does not warn when source path has upstream estimator outputs list", () => {
		const graph = parse(`
	digraph estimator_with_outputs_list {
		start [shape=Mdiamond]
		estimate [type="tool" prompt="estimate" outputs="complexity_class,reason" governance="reversible"]
		route [shape=diamond]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> estimate -> route
		route -> fast [condition="complexity_class=low"]
		route -> full [condition="complexity_class!=low"]
	}
		`);

		const errors = validate(graph);
		expect(errors.find((entry) => entry.rule === "complexity_estimator_provenance")).toBeUndefined();
		expect(hasValidationErrors(errors)).toBe(false);
	});

	it("does not warn for legacy complexity condition when estimator emits legacy key", () => {
		const graph = parse(`
	digraph estimator_with_legacy_complexity_key {
		start [shape=Mdiamond]
		estimate [type="tool" prompt="estimate" output_key="complexity" governance="reversible"]
		route [shape=diamond]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> estimate -> route
		route -> fast [condition="complexity=low"]
		route -> full [condition="complexity!=low"]
	}
		`);

		const errors = validate(graph);
		expect(errors.find((entry) => entry.rule === "complexity_estimator_provenance")).toBeUndefined();
		expect(hasValidationErrors(errors)).toBe(false);
	});

	it("matches only explicit complexity routing keys (complexity_class|complexity)", () => {
		const graph = parse(`
	digraph explicit_match_only {
		start [shape=Mdiamond]
		route [shape=diamond]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> route
		route -> fast [condition="task_complexity=low"]
		route -> full [condition="complexity=true"]
	}
		`);

		const errors = validate(graph);
		const warnings = errors.filter((entry) => entry.rule === "complexity_estimator_provenance");
		expect(warnings.length).toBe(1);
		expect(warnings[0]?.message).toContain("complexity routing key");
		expect(hasValidationErrors(errors)).toBe(false);
	});

	it("formats warning diagnostics with warning prefix", () => {
		const graph = parse(`
	digraph warning_format {
		start [shape=Mdiamond]
		route [shape=diamond]
		fast [shape=Msquare]
		full [shape=Msquare]

		start -> route
		route -> fast [condition="complexity_class=high"]
		route -> full
	}
		`);

		const errors = validate(graph);
		const warning = errors.find((entry) => entry.rule === "complexity_estimator_provenance");
		expect(warning).toBeDefined();
		expect(formatValidationError(warning!)).toContain("warning [complexity_estimator_provenance]");
		expect(hasValidationErrors(errors)).toBe(false);
	});
});
