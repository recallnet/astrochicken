import { nodeClass } from "./graph.js";

import type { Node } from "./graph.js";

/** Selector is a CSS-like selector for matching pipeline nodes. */
export interface Selector {
	raw: string;
	type: "*" | "." | "#";
	value: string;
}

/** StyleRule is a single selector -> properties mapping. */
export interface StyleRule {
	selector: Selector;
	properties: Record<string, string>;
}

/** Stylesheet represents a model stylesheet with CSS-like selectors. */
export interface Stylesheet {
	rules: StyleRule[];
}

/** Selector specificity: * = 0, .class = 1, #id = 2 */
export function selectorSpecificity(s: Selector): number {
	switch (s.type) {
		case "#":
			return 2;
		case ".":
			return 1;
		default:
			return 0;
	}
}

/** Check if a selector matches a given node. */
export function selectorMatches(s: Selector, node: Node): boolean {
	switch (s.type) {
		case "*":
			return true;
		case ".": {
			const classes = nodeClass(node);
			if (!classes) return false;
			return classes.split(",").some((c) => c.trim() === s.value);
		}
		case "#":
			return node.id === s.value;
		default:
			return false;
	}
}

/** Apply stylesheet rules to a node, returning resolved properties. */
export function applyStylesheetToNode(ss: Stylesheet, node: Node): Record<string, string> {
	const result: Record<string, string> = {};

	const matches: Array<{ specificity: number; index: number; props: Record<string, string> }> = [];
	for (let i = 0; i < ss.rules.length; i++) {
		const rule = ss.rules[i];
		if (selectorMatches(rule.selector, node)) {
			matches.push({
				specificity: selectorSpecificity(rule.selector),
				index: i,
				props: rule.properties,
			});
		}
	}

	// Apply in source order (higher specificity naturally overrides)
	for (const m of matches) {
		Object.assign(result, m.props);
	}

	return result;
}

/** Parse a CSS-like model stylesheet string. */
export function parseStylesheet(input: string): Stylesheet {
	const rules: StyleRule[] = [];
	input = input.trim();
	if (!input) return { rules };

	let i = 0;

	while (i < input.length) {
		// Skip whitespace
		while (i < input.length && isWS(input[i])) i++;
		if (i >= input.length) break;

		// Read selector
		const selStart = i;
		while (i < input.length && input[i] !== "{" && !isWS(input[i])) i++;
		const selText = input.substring(selStart, i).trim();
		if (!selText) break;
		const selector = parseSelector(selText);

		// Skip to {
		while (i < input.length && input[i] !== "{") i++;
		if (i >= input.length) break;
		i++; // skip {

		// Read properties until }
		const properties: Record<string, string> = {};
		while (i < input.length && input[i] !== "}") {
			while (i < input.length && isWS(input[i])) i++;
			if (i >= input.length || input[i] === "}") break;

			// Read key
			const keyStart = i;
			while (i < input.length && input[i] !== "=" && input[i] !== ":" && input[i] !== "}" && !isWS(input[i])) i++;
			const key = input.substring(keyStart, i).trim();

			// Skip whitespace and = or :
			while (i < input.length && (isWS(input[i]) || input[i] === "=" || input[i] === ":")) i++;

			// Read value (may be quoted)
			let val: string;
			if (i < input.length && input[i] === '"') {
				i++; // skip opening "
				const valStart = i;
				while (i < input.length && input[i] !== '"') i++;
				val = input.substring(valStart, i);
				if (i < input.length) i++; // skip closing "
			} else {
				const valStart = i;
				while (i < input.length && input[i] !== ";" && input[i] !== "}" && !isWS(input[i])) i++;
				val = input.substring(valStart, i).trim();
			}

			if (key) properties[key] = val;

			// Skip semicolons
			while (i < input.length && (input[i] === ";" || isWS(input[i]))) i++;
		}

		if (i < input.length) i++; // skip }

		rules.push({ selector, properties });
	}

	return { rules };
}

function parseSelector(s: string): Selector {
	s = s.trim();
	if (s === "*") return { raw: s, type: "*", value: "" };
	if (s.startsWith(".")) return { raw: s, type: ".", value: s.substring(1) };
	if (s.startsWith("#")) return { raw: s, type: "#", value: s.substring(1) };
	// Bare word = ID selector
	return { raw: s, type: "#", value: s };
}

function isWS(c: string): boolean {
	return c === " " || c === "\t" || c === "\n" || c === "\r";
}
