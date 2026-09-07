import { applyStylesheetToNode } from "./stylesheet.js";

import type { Context } from "./context.js";
import type { Graph } from "./graph.js";
import type { Stylesheet } from "./stylesheet.js";


/**
 * Apply a model stylesheet to all nodes in the graph.
 * Stylesheet properties are written with lower precedence than explicit attributes.
 */
export function applyStylesheet(g: Graph, ss: Stylesheet): void {
	for (const node of Object.values(g.nodes)) {
		const props = applyStylesheetToNode(ss, node);
		for (const [k, v] of Object.entries(props)) {
			if (!(k in node.attrs)) {
				node.attrs[k] = v;
			}
		}
	}
}

/**
 * Expand ${key} placeholders in all node and edge string attributes
 * using values from the pipeline context.
 */
export function expandGraphVariables(g: Graph, ctx: Context): void {
	const lookup = ctx.lookup();

	for (const [k, v] of Object.entries(g.attrs)) {
		g.attrs[k] = expandVars(v, lookup);
	}
	for (const node of Object.values(g.nodes)) {
		for (const [k, v] of Object.entries(node.attrs)) {
			node.attrs[k] = expandVars(v, lookup);
		}
	}
	for (const edge of g.edges) {
		for (const [k, v] of Object.entries(edge.attrs)) {
			edge.attrs[k] = expandVars(v, lookup);
		}
	}
}

/** Replace ${key} placeholders in a string with context values. */
function expandVars(s: string, lookup: (key: string) => string): string {
	let result = "";
	let i = 0;
	while (i < s.length) {
		if (i + 1 < s.length && s[i] === "$" && s[i + 1] === "{") {
			const end = s.indexOf("}", i);
			if (end < 0) {
				result += s[i];
				i++;
				continue;
			}
			const key = s.substring(i + 2, end);
			result += lookup(key);
			i = end + 1;
		} else {
			result += s[i];
			i++;
		}
	}
	return result;
}
