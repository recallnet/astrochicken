import { describe, it, expect } from "vitest";
import { applyStylesheet, expandGraphVariables } from "./transform.js";
import { Context } from "./context.js";
import type { Graph } from "./graph.js";
import type { Stylesheet } from "./stylesheet.js";

function makeGraph(overrides?: Partial<Graph>): Graph {
	return {
		name: "test",
		attrs: {},
		nodes: {},
		edges: [],
		...overrides,
	};
}

describe("expandGraphVariables", () => {
	it("expands ${key} in graph attrs", () => {
		const g = makeGraph({ attrs: { title: "Run ${run_id}" } });
		const ctx = new Context({ run_id: "abc123" });
		expandGraphVariables(g, ctx);
		expect(g.attrs["title"]).toBe("Run abc123");
	});

	it("expands ${key} in node attrs", () => {
		const g = makeGraph({
			nodes: { n1: { id: "n1", attrs: { prompt: "Hello ${name}" } } },
		});
		const ctx = new Context({ name: "world" });
		expandGraphVariables(g, ctx);
		expect(g.nodes["n1"].attrs["prompt"]).toBe("Hello world");
	});

	it("expands ${key} in edge attrs", () => {
		const g = makeGraph({
			edges: [{ from: "a", to: "b", attrs: { label: "${status}" } }],
		});
		const ctx = new Context({ status: "done" });
		expandGraphVariables(g, ctx);
		expect(g.edges[0].attrs["label"]).toBe("done");
	});

	it("expands multiple variables in one string", () => {
		const g = makeGraph({ attrs: { msg: "${a} and ${b}" } });
		const ctx = new Context({ a: "x", b: "y" });
		expandGraphVariables(g, ctx);
		expect(g.attrs["msg"]).toBe("x and y");
	});

	it("resolves missing variable to empty string", () => {
		const g = makeGraph({ attrs: { msg: "hi ${missing}" } });
		const ctx = new Context();
		expandGraphVariables(g, ctx);
		expect(g.attrs["msg"]).toBe("hi ");
	});

	it("leaves plain text unchanged", () => {
		const g = makeGraph({ attrs: { msg: "plain text" } });
		const ctx = new Context();
		expandGraphVariables(g, ctx);
		expect(g.attrs["msg"]).toBe("plain text");
	});

	it("treats unclosed brace as literal characters", () => {
		const g = makeGraph({ attrs: { msg: "${key" } });
		const ctx = new Context({ key: "val" });
		expandGraphVariables(g, ctx);
		expect(g.attrs["msg"]).toBe("${key");
	});

	it("expands adjacent variables", () => {
		const g = makeGraph({ attrs: { msg: "${a}${b}" } });
		const ctx = new Context({ a: "x", b: "y" });
		expandGraphVariables(g, ctx);
		expect(g.attrs["msg"]).toBe("xy");
	});

	it("resolves empty variable name", () => {
		const g = makeGraph({ attrs: { msg: "${}" } });
		const ctx = new Context();
		expandGraphVariables(g, ctx);
		// empty key resolves via ctx.get("") which returns ""
		expect(g.attrs["msg"]).toBe("");
	});
});

describe("applyStylesheet", () => {
	it("applies wildcard rule properties to all nodes", () => {
		const g = makeGraph({
			nodes: {
				a: { id: "a", attrs: {} },
				b: { id: "b", attrs: {} },
			},
		});
		const ss: Stylesheet = {
			rules: [
				{ selector: { raw: "*", type: "*", value: "" }, properties: { llm_model: "gpt-4" } },
			],
		};
		applyStylesheet(g, ss);
		expect(g.nodes["a"].attrs["llm_model"]).toBe("gpt-4");
		expect(g.nodes["b"].attrs["llm_model"]).toBe("gpt-4");
	});

	it("does not override existing node attributes", () => {
		const g = makeGraph({
			nodes: {
				a: { id: "a", attrs: { llm_model: "claude" } },
			},
		});
		const ss: Stylesheet = {
			rules: [
				{ selector: { raw: "*", type: "*", value: "" }, properties: { llm_model: "gpt-4" } },
			],
		};
		applyStylesheet(g, ss);
		expect(g.nodes["a"].attrs["llm_model"]).toBe("claude");
	});

	it("applies class selector to matching nodes only", () => {
		const g = makeGraph({
			nodes: {
				a: { id: "a", attrs: { class: "worker" } },
				b: { id: "b", attrs: {} },
			},
		});
		const ss: Stylesheet = {
			rules: [
				{ selector: { raw: ".worker", type: ".", value: "worker" }, properties: { timeout: "30s" } },
			],
		};
		applyStylesheet(g, ss);
		expect(g.nodes["a"].attrs["timeout"]).toBe("30s");
		expect(g.nodes["b"].attrs["timeout"]).toBeUndefined();
	});

	it("applies id selector to matching node only", () => {
		const g = makeGraph({
			nodes: {
				a: { id: "a", attrs: {} },
				b: { id: "b", attrs: {} },
			},
		});
		const ss: Stylesheet = {
			rules: [
				{ selector: { raw: "#a", type: "#", value: "a" }, properties: { fidelity: "high" } },
			],
		};
		applyStylesheet(g, ss);
		expect(g.nodes["a"].attrs["fidelity"]).toBe("high");
		expect(g.nodes["b"].attrs["fidelity"]).toBeUndefined();
	});

	it("applies multiple properties from a single rule", () => {
		const g = makeGraph({
			nodes: { a: { id: "a", attrs: {} } },
		});
		const ss: Stylesheet = {
			rules: [
				{
					selector: { raw: "*", type: "*", value: "" },
					properties: { llm_model: "gpt-4", reasoning_effort: "low" },
				},
			],
		};
		applyStylesheet(g, ss);
		expect(g.nodes["a"].attrs["llm_model"]).toBe("gpt-4");
		expect(g.nodes["a"].attrs["reasoning_effort"]).toBe("low");
	});

	it("handles empty stylesheet with no rules", () => {
		const g = makeGraph({
			nodes: { a: { id: "a", attrs: { prompt: "hi" } } },
		});
		const ss: Stylesheet = { rules: [] };
		applyStylesheet(g, ss);
		expect(g.nodes["a"].attrs["prompt"]).toBe("hi");
	});
});
