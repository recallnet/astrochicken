import { describe, expect, it } from "vitest";

import { nodeTimeout } from "../graph.js";
import { parse } from "../parse.js";

describe("nodeTimeout timeout-only interpolation", () => {
	it("preserves literal timeout behavior", () => {
		const graph = parse(`
			digraph timeout_literal {
				n [timeout="30m"]
			}
		`);
		expect(nodeTimeout(graph.nodes.n)).toBe(1_800_000);
	});

	it("resolves ${...} timeout placeholders with runtime lookup", () => {
		const graph = parse(`
			digraph timeout_template {
				n [timeout="\${goal_decomposition_timeouts.issue_draft}"]
			}
		`);
		expect(nodeTimeout(graph.nodes.n, (key) => key === "goal_decomposition_timeouts.issue_draft" ? "250ms" : "")).toBe(250);
	});

	it("returns 0 when timeout placeholder resolves to empty value", () => {
		const graph = parse(`
			digraph timeout_empty {
				n [timeout="\${goal_decomposition_timeouts.issue_draft}"]
			}
		`);
		expect(nodeTimeout(graph.nodes.n, () => "")).toBe(0);
	});
});
