export function parse(input) {
  const parser = new Parser(input);
  parser.parse();
  return parser.graph;
}

export function parseWithAst(input) {
  const parser = new Parser(input);
  parser.parse();
  return {
    graph: parser.graph,
    nodes: [...parser.nodesAst],
    stylesheetImports: [...parser.stylesheetImports],
  };
}

class Parser {
  constructor(input) {
    this.input = String(input ?? "");
    this.pos = 0;
    this.graph = { name: "", attrs: {}, nodes: {}, edges: [] };
    this.nodeDefaults = {};
    this.edgeDefaults = {};
    this.nodesAst = [];
    this.stylesheetImports = [];
    this.lineStarts = computeLineStarts(this.input);
  }

  parse() {
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

  parseBody(allowImports) {
    while (true) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.input.length || this.peek() === "}") return;
      this.parseStatement(allowImports);
      this.skipWhitespaceAndComments();
      this.matchChar(";");
    }
  }

  parseStatement(allowImports) {
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
      this.advance();
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

    const node = this.ensureNode(id);
    let attrList = null;
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

  parseTopLevelImports() {
    while (true) {
      this.skipWhitespaceAndComments();
      if (this.peek() !== "@") return;
      this.parseImportDirectiveOrThrow();
      this.skipWhitespaceAndComments();
      this.matchChar(";");
    }
  }

  parseImportDirectiveOrThrow() {
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

  readBareKeyword() {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    while (this.pos < this.input.length && /[a-zA-Z]/.test(this.input[this.pos])) {
      this.pos += 1;
    }
    return this.input.substring(start, this.pos);
  }

  parseSubgraph() {
    this.skipWhitespaceAndComments();
    if (this.peek() !== "{") {
      this.readID();
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

  parseEdgeStatement() {
    const nodeIDs = [];

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

    let attrs = {};
    this.skipWhitespaceAndComments();
    if (this.peek() === "[") {
      attrs = this.parseAttrList().attrs;
    }

    for (let index = 0; index < nodeIDs.length - 1; index += 1) {
      const edgeAttrs = { ...this.edgeDefaults, ...attrs };
      const edge = { from: nodeIDs[index], to: nodeIDs[index + 1], attrs: edgeAttrs };
      this.graph.edges.push(edge);
    }
  }

  parseAttrList() {
    const attrs = {};
    if (!this.matchChar("[")) return { attrs, attrList: null };
    const start = this.pos - 1;
    const entries = [];

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

  ensureNode(id) {
    if (this.graph.nodes[id]) return this.graph.nodes[id];
    const node = { id, attrs: { ...this.nodeDefaults } };
    this.graph.nodes[id] = node;
    return node;
  }

  peek() {
    if (this.pos >= this.input.length) return "\0";
    return this.input[this.pos];
  }

  advance() {
    if (this.pos < this.input.length) this.pos += 1;
  }

  matchChar(char) {
    if (this.pos < this.input.length && this.input[this.pos] === char) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  matchKeyword(keyword) {
    if (this.pos + keyword.length > this.input.length) return false;
    const candidate = this.input.substring(this.pos, this.pos + keyword.length);
    if (candidate.toLowerCase() !== keyword.toLowerCase()) return false;
    const end = this.pos + keyword.length;
    if (end < this.input.length && isIDChar(this.input[end])) return false;
    this.pos = end;
    return true;
  }

  lookingAtArrow() {
    if (this.pos + 1 >= this.input.length) return false;
    return this.input[this.pos] === "-" && this.input[this.pos + 1] === ">";
  }

  matchArrow() {
    if (this.lookingAtArrow()) {
      this.pos += 2;
      return true;
    }
    return false;
  }

  readID() {
    const token = this.readIDToken();
    return token ? token.value : "";
  }

  readIDToken() {
    this.skipWhitespaceAndComments();
    if (this.pos >= this.input.length) return null;

    const start = this.pos;

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

    while (this.pos < this.input.length && isIDChar(this.input[this.pos])) {
      this.pos += 1;
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

  readQuotedString() {
    this.advance();
    let output = "";
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];
      if (char === "\\" && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        switch (next) {
          case '"':
          case "\\":
            output += next;
            this.pos += 2;
            continue;
          case "n":
            output += "\n";
            this.pos += 2;
            continue;
          case "t":
            output += "\t";
            this.pos += 2;
            continue;
          default:
            output += next;
            this.pos += 2;
            continue;
        }
      }
      if (char === '"') {
        this.advance();
        return output;
      }
      output += char;
      this.advance();
    }
    return output;
  }

  readHTMLString() {
    this.advance();
    let depth = 1;
    let output = "";
    while (this.pos < this.input.length && depth > 0) {
      const char = this.input[this.pos];
      if (char === "<") depth += 1;
      else if (char === ">") {
        depth -= 1;
        if (depth === 0) {
          this.advance();
          return output;
        }
      }
      output += char;
      this.advance();
    }
    return output;
  }

  skipWhitespaceAndComments() {
    while (this.pos < this.input.length) {
      const char = this.input[this.pos];

      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        this.pos += 1;
        continue;
      }

      if (char === "/" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "/") {
        this.pos += 2;
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos += 1;
        continue;
      }

      if (char === "/" && this.pos + 1 < this.input.length && this.input[this.pos + 1] === "*") {
        this.pos += 2;
        while (this.pos + 1 < this.input.length) {
          if (this.input[this.pos] === "*" && this.input[this.pos + 1] === "/") {
            this.pos += 2;
            break;
          }
          this.pos += 1;
        }
        continue;
      }

      if (char === "#") {
        this.pos += 1;
        while (this.pos < this.input.length && this.input[this.pos] !== "\n") this.pos += 1;
        continue;
      }

      break;
    }
  }

  error(message) {
    const { line, column } = this.locationAt(this.pos);
    return new Error(`parse error at line ${line} col ${column}: ${message}`);
  }

  locationAt(offset) {
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

function isIDChar(char) {
  return /[a-zA-Z0-9_.]/.test(char);
}

function computeLineStarts(input) {
  const starts = [0];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}
