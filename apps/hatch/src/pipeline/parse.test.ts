import { describe, expect, it } from "vitest";

import { parse, parseWithAst } from "./parse.js";

describe("parse stylesheet imports", () => {
	it("collects @import directives declared before digraph in source order", () => {
		const parsed = parseWithAst(`
			@import "styles/base.stylesheet";
			@import "styles/reviewer.stylesheet"
			digraph sample {
				start [shape=Mdiamond]
				done [shape=Msquare]
				start -> done
			}
		`);

		expect(parsed.stylesheetImports).toEqual([
			"styles/base.stylesheet",
			"styles/reviewer.stylesheet",
		]);
		expect(Object.keys(parsed.graph.nodes).sort()).toEqual(["done", "start"]);
	});

	it("collects @import directives inside graph top-level body", () => {
		const parsed = parseWithAst(`
			digraph sample {
				@import "styles/defaults.stylesheet"
				@import "styles/role.stylesheet";
				start [shape=Mdiamond]
				done [shape=Msquare]
				start -> done
			}
		`);

		expect(parsed.stylesheetImports).toEqual([
			"styles/defaults.stylesheet",
			"styles/role.stylesheet",
		]);
	});

	it("rejects @import inside subgraph scope", () => {
		expect(() => parseWithAst(`
			digraph invalid {
				start [shape=Mdiamond]
				subgraph cluster_a {
					@import "styles/base.stylesheet"
				}
			}
		`)).toThrow("@import is only allowed at graph top-level");
	});

	it("keeps parse() backward compatible for graphs without imports", () => {
		const graph = parse(`
			digraph legacy {
				start [shape=Mdiamond]
				done [shape=Msquare]
				start -> done
			}
		`);

		expect(graph.name).toBe("legacy");
		expect(Object.keys(graph.nodes).sort()).toEqual(["done", "start"]);
	});
});
