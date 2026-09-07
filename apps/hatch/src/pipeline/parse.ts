import type { Edge, Graph, Node } from "./graph.js";

export interface DotIdentifierToken {
	value: string;
	raw: string;
	start: number;
	end: number;
	line: number;
	column: number;
}

export interface DotAttrEntry {
	key: string;
	keyRaw: string;
	keyStart: number;
	keyEnd: number;
	value: string;
	valueRaw: string;
	valueStart: number;
	valueEnd: number;
	line: number;
	column: number;
}

export interface DotAttrList {
	start: number;
	end: number;
	raw: string;
	entries: DotAttrEntry[];
}

export interface DotNodeAst {
	id: string;
	idToken: DotIdentifierToken;
	attrList: DotAttrList | null;
}

export interface DotParseWithAstResult {
	graph: Graph;
	nodes: DotNodeAst[];
	stylesheetImports: string[];
}

/**
 * Parse a DOT-format string into a Graph.
 * Supports: digraph only, node/edge attrs, chained edges (A -> B -> C),
 * subgraphs, defaults (node [...], edge [...]), comments (// and /* and #),
 * and hatch-specific @import "path/to/file.stylesheet" directives at graph top-level.
 */
export function parse(input: string): Graph {
	const p = new Parser(input);
	p.parse();
	return p.graph;
}

export function parseWithAst(input: string): DotParseWithAstResult {
	const p = new Parser(input);
	p.parse();
	return {
		graph: p.graph,
		nodes: [...p.nodesAst],
		stylesheetImports: [...p.stylesheetImports],
	};
}

interface ParsedAttrList {
	attrs: Record<string, string>;
	attrList: DotAttrList | null;
}

class Parser {
	private pos = 0;
	graph: Graph;
	private nodeDefaults: Record<string, string> = {};
	private edgeDefaults: Record<string, string> = {};
	readonly nodesAst: DotNodeAst[] = [];
	readonly stylesheetImports: string[] = [];
	private readonly lineStarts: number[];

	constructor(private input: string) {
		this.graph = { name: "", attrs: {}, nodes: {}, edges: [] };
		this.lineStarts = computeLineStarts(this.input);
	}

	parse(): void {
		this.parseTopLevelImports();
		this.skipWhitespaceAndComments();

		if (this.matchKeyword("strict")) {
			this.skipWhitespaceAndComments();
			this.parseTopLevelImports();
			this.skipWhitespaceAndComments();
		}
		if (!this.matchKeyword("digraph")) {
			throw this.error("expected 'digraph'");
		}
		this.skipWhitespaceAndComments();

		// Optional graph name
		if (this.peek() !== "{") {
			const name = this.readID();
			if (name) this.graph.name = name;
			this.skipWhitespaceAndComments();
		}

		if (!this.matchChar("{")) {
			throw this.error("expected '{'");
		}

		this.parseBody(true);

		if (!this.matchChar("}")) {
			throw this.error("expected '}'");
		}
	}

	private parseBody(allowImports: boolean): void {
		while (true) {
			this.skipWhitespaceAndComments();
			if (this.pos >= this.input.length || this.peek() === "}") return;
			this.parseStatement(allowImports);
			this.skipWhitespaceAndComments();
			this.matchChar(";"); // optional semicolon
		}
	}

	private parseStatement(allowImports: boolean): void {
		this.skipWhitespaceAndComments();

		if (this.peek() === "@") {
			if (!allowImports) {
				throw this.error("@import is only allowed at graph top-level");
			}
			this.parseImportDirectiveOrThrow();
			return;
		}

		if (this.matchKeyword("subgraph")) {
			this.parseSubgraph();
			return;
		}

		const saved = this.pos;
		const idToken = this.readIDToken();
		if (!idToken) throw this.error("expected identifier");
		const id = idToken.value;

		this.skipWhitespaceAndComments();

		if (id === "node") {
			const { attrs } = this.parseAttrList();
			Object.assign(this.nodeDefaults, attrs);
			return;
		}

		if (id === "edge") {
			const { attrs } = this.parseAttrList();
			Object.assign(this.edgeDefaults, attrs);
			return;
		}

		if (this.peek() === "=" && !this.lookingAtArrow()) {
			this.advance(); // skip =
			this.skipWhitespaceAndComments();
			const val = this.readID();
			this.graph.attrs[id] = val;
			return;
		}

		if (this.lookingAtArrow()) {
			this.pos = saved;
			this.parseEdgeStatement();
			return;
		}

		// Node statement
		const node = this.ensureNode(id);
		let attrList: DotAttrList | null = null;
		if (this.peek() === "[") {
			const parsed = this.parseAttrList();
			attrList = parsed.attrList;
			Object.assign(node.attrs, parsed.attrs);
		}

		this.nodesAst.push({
			id,
			idToken,
			attrList,
		});
	}

	private parseTopLevelImports(): void {
		while (true) {
			this.skipWhitespaceAndComments();
			if (this.peek() !== "@") return;
			this.parseImportDirectiveOrThrow();
			this.skipWhitespaceAndComments();
			this.matchChar(";");
		}
	}

	private parseImportDirectiveOrThrow(): void {
		if (!this.matchChar("@")) {
			throw this.error("expected '@import'");
		}

		const keyword = this.readBareKeyword();
		if (keyword.toLowerCase() !== "import") {
			throw this.error("expected '@import'");
		}

		this.skipWhitespaceAndComments();
		const literal = this.readIDToken();
		if (!literal || !literal.raw.startsWith('"')) {
			throw this.error("@import expects a quoted stylesheet path");
		}
		if (!literal.value.endsWith(".stylesheet")) {
			throw this.error("@import path must end with .stylesheet");
		}

		this.stylesheetImports.push(literal.value);
	}

	private readBareKeyword(): string {
		this.skipWhitespaceAndComments();
		const start = this.pos;
		while (this.pos < this.input.length && /[a-zA-Z]/.test(this.input[this.pos])) {
			this.pos++;
		}
		return this.input.substring(start, this.pos);
	}

	private parseSubgraph(): void {
		this.skipWhitespaceAndComments();
		if (this.peek() !== "{") {
			this.readID(); // consume optional name
		}
		this.skipWhitespaceAndComments();
		if (!this.matchChar("{")) {
			throw this.error("expected '{' in subgraph");
		}
		this.parseBody(false);
		if (!this.matchChar("}")) {
			throw this.error("expected '}' in subgraph");
		}
	}

	private parseEdgeStatement(): void {
		const nodeIDs: string[] = [];

		const id = this.readID();
		if (!id) throw this.error("expected node ID in edge");
		nodeIDs.push(id);
		this.ensureNode(id);

		while (true) {
			this.skipWhitespaceAndComments();
			if (!this.matchArrow()) break;
			this.skipWhitespaceAndComments();
			const nextID = this.readID();
			if (!nextID) throw this.error("expected node ID after '->'");
			nodeIDs.push(nextID);
			this.ensureNode(nextID);
		}

		// Optional attributes
		let attrs: Record<string, string> = {};
		this.skipWhitespaceAndComments();
		if (this.peek() === "[") {
			attrs = this.parseAttrList().attrs;
		}

		// Create edges for the chain
		for (let i = 0; i < nodeIDs.length - 1; i++) {
			const edgeAttrs: Record<string, string> = { ...this.edgeDefaults, ...attrs };
			const edge: Edge = { from: nodeIDs[i], to: nodeIDs[i + 1], attrs: edgeAttrs };
			this.graph.edges.push(edge);
		}
	}

	private parseAttrList(): ParsedAttrList {
		const attrs: Record<string, string> = {};
		if (!this.matchChar("[")) return { attrs, attrList: null };
		const start = this.pos - 1;
		const entries: DotAttrEntry[] = [];

		while (true) {
			this.skipWhitespaceAndComments();
			if (this.peek() === "]") {
				this.advance();
				const end = this.pos;
				return {
					attrs,
					attrList: {
						start,
						end,
						raw: this.input.substring(start, end),
						entries,
					},
				};
			}
			if (this.pos >= this.input.length) {
				throw this.error("unexpected EOF in attribute list");
			}

			const keyToken = this.readIDToken();
			if (!keyToken) throw this.error("expected attribute key");

			this.skipWhitespaceAndComments();
			if (!this.matchChar("=")) {
				throw this.error("expected '=' in attribute");
			}
			this.skipWhitespaceAndComments();

			const valueToken = this.readIDToken();
			if (!valueToken) throw this.error("expected attribute value");
			attrs[keyToken.value] = valueToken.value;
			entries.push({
				key: keyToken.value,
				keyRaw: keyToken.raw,
				keyStart: keyToken.start,
				keyEnd: keyToken.end,
				value: valueToken.value,
				valueRaw: valueToken.raw,
				valueStart: valueToken.start,
				valueEnd: valueToken.end,
				line: keyToken.line,
				column: keyToken.column,
			});

			this.skipWhitespaceAndComments();
			if (this.peek() === "," || this.peek() === ";") {
				this.advance();
			}
		}
	}

	private ensureNode(id: string): Node {
		if (this.graph.nodes[id]) return this.graph.nodes[id];
		const node: Node = { id, attrs: { ...this.nodeDefaults } };
		this.graph.nodes[id] = node;
		return node;
	}

	// ── Lexer helpers ──

	private peek(): string {
		if (this.pos >= this.input.length) return "\0";
		return this.input[this.pos];
	}

	private advance(): void {
		if (this.pos < this.input.length) this.pos++;
	}

	private matchChar(c: string): boolean {
		if (this.pos < this.input.length && this.input[this.pos] === c) {
			this.pos++;
			return true;
		}
		return false;
	}

	private matchKeyword(kw: string): boolean {
		if (this.pos + kw.length > this.input.length) return false;
		const candidate = this.input.substring(this.pos, this.pos + kw.length);
		if (candidate.toLowerCase() !== kw.toLowerCase()) return false;
		// Must not be followed by an identifier char
		const end = this.pos + kw.length;
		if (end < this.input.length && isIDChar(this.input[end])) return false;
		this.pos = end;
		return true;
	}

	private lookingAtArrow(): boolean {
		if (this.pos + 1 >= this.input.length) return false;
		return this.input[this.pos] === "-" && this.input[this.pos + 1] === ">";
	}

	private matchArrow(): boolean {
		if (this.lookingAtArrow()) {
			this.pos += 2;
			return true;
		}
		return false;
	}

	private readID(): string {
		const token = this.readIDToken();
		return token ? token.value : "";
	}

	private readIDToken(): DotIdentifierToken | null {
		this.skipWhitespaceAndComments();
		if (this.pos >= this.input.length) return null;

		const start = this.pos;

		// Quoted string
		if (this.input[this.pos] === '"') {
			const value = this.readQuotedString();
			const end = this.pos;
			const { line, column } = this.locationAt(start);
			return {
				value,
				raw: this.input.substring(start, end),
				start,
				end,
				line,
				column,
			};
		}

		// HTML string <>
		if (this.input[this.pos] === "<") {
			const value = this.readHTMLString();
			const end = this.pos;
			const { line, column } = this.locationAt(start);
			return {
				value,
				raw: this.input.substring(start, end),
				start,
				end,
				line,
				column,
			};
		}

		// Bare identifier or number
		while (this.pos < this.input.length && isIDChar(this.input[this.pos])) {
			this.pos++;
		}
		if (this.pos === start) return null;

		const end = this.pos;
		const { line, column } = this.locationAt(start);
		return {
			value: this.input.substring(start, end),
			raw: this.input.substring(start, end),
			start,
			end,
			line,
			column,
		};
	}

	private readQuotedString(): string {
		this.advance(); // skip opening "
		let sb = "";
		while (this.pos < this.input.length) {
			const c = this.input[this.pos];
			if (c === "\\" && this.pos + 1 < this.input.length) {
				const next = this.input[this.pos + 1];
				switch (next) {
					case '"':
					case "\\":
						sb += next;
						this.pos += 2;
						continue;
					case "n":
						sb += "\n";
						this.pos += 2;
						continue;
					case "t":
						sb += "\t";
						this.pos += 2;
						continue;
					default:
						sb += next;
						this.pos += 2;
						continue;
				}
			}
			if (c === '"') {
				this.advance();
				return sb;
			}
			sb += c;
			this.advance();
		}
		return sb;
	}

	private readHTMLString(): string {
		this.advance(); // skip <
		let depth = 1;
		let sb = "";
		while (this.pos < this.input.length && depth > 0) {
			const c = this.input[this.pos];
			if (c === "<") depth++;
			else if (c === ">") {
				depth--;
				if (depth === 0) {
					this.advance();
					return sb;
				}
			}
			sb += c;
			this.advance();
		}
		return sb;
	}

	private skipWhitespaceAndComments(): void {
		while (this.pos < this.input.length) {
			const c = this.input[this.pos];

			// Whitespace
			if (c === " " || c === "\t" || c === "\n" || c === "\r") {
				this.pos++;
				continue;
			}

			// Line comment //
			if (c === "/" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "/") {
				this.pos += 2;
				while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos++;
				continue;
			}

			// Block comment /* */
			if (c === "/" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "*") {
				this.pos += 2;
				while (this.pos + 1 < this.input.length) {
					if (this.input[this.pos] === "*" && this.input[this.pos + 1] === "/") {
						this.pos += 2;
						break;
					}
					this.pos++;
				}
				continue;
			}

			// Hash comment #
			if (c === "#") {
				this.pos++;
				while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos++;
				continue;
			}

			break;
		}
	}

	private error(message: string): Error {
		const { line, column } = this.locationAt(this.pos);
		return new Error(`parse error at line ${line} col ${column}: ${message}`);
	}

	private locationAt(offset: number): { line: number; column: number } {
		const clamped = Math.max(0, Math.min(offset, this.input.length));
		let low = 0;
		let high = this.lineStarts.length - 1;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			if (this.lineStarts[mid] <= clamped) {
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		const lineIndex = Math.max(0, high);
		const lineStart = this.lineStarts[lineIndex] ?? 0;
		return {
			line: lineIndex + 1,
			column: clamped - lineStart + 1,
		};
	}
}

function isIDChar(c: string): boolean {
	return /[a-zA-Z0-9_.]/.test(c);
}

function computeLineStarts(input: string): number[] {
	const starts: number[] = [0];
	for (let index = 0; index < input.length; index++) {
		if (input[index] === "\n") {
			starts.push(index + 1);
		}
	}
	return starts;
}
