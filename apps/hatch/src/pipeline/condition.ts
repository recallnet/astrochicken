/** ConditionClause is a single comparison. */
export interface ConditionClause {
	key: string;
	op: "=" | "!=" | ">" | "<" | ">=" | "<=";
	value: string;
}

/** ConditionExpr represents a parsed condition expression. */
export class ConditionExpr {
	constructor(public readonly clauses: ConditionClause[]) {}

	/** Evaluate the condition against a key-value lookup function. */
	evaluate(lookup: (key: string) => string): boolean {
		if (this.clauses.length === 0) return true;
		for (const c of this.clauses) {
			const val = lookup(c.key).trim();
			switch (c.op) {
				case "=":
					if (val !== c.value) return false;
					break;
				case "!=":
					if (val === c.value) return false;
					break;
				case ">":
				case "<":
				case ">=":
				case "<=": {
					const numVal = Number(val);
					const numTarget = Number(c.value);
					if (isNaN(numVal) || isNaN(numTarget)) return false;
					if (c.op === ">" && !(numVal > numTarget)) return false;
					if (c.op === "<" && !(numVal < numTarget)) return false;
					if (c.op === ">=" && !(numVal >= numTarget)) return false;
					if (c.op === "<=" && !(numVal <= numTarget)) return false;
					break;
				}
			}
		}
		return true;
	}

	toString(): string {
		return this.clauses.map((c) => `${c.key}${c.op}${c.value}`).join(" && ");
	}
}

/** Parse a condition expression string. Returns null for empty strings. */
export function parseCondition(s: string): ConditionExpr | null {
	s = s.trim();
	if (!s) return null;

	const clauses: ConditionClause[] = [];
	const parts = s.split("&&");

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		const clause = parseClause(trimmed);
		if (clause) clauses.push(clause);
	}

	return new ConditionExpr(clauses);
}

function parseClause(s: string): ConditionClause | null {
	// Parse order: >=, <=, !=, >, <, = (longest match first)
	for (const op of [">=", "<=", "!=", ">", "<", "="] as const) {
		const idx = s.indexOf(op);
		if (idx >= 0) {
			return {
				key: s.substring(0, idx).trim(),
				op,
				value: s.substring(idx + op.length).trim(),
			};
		}
	}
	// Bare key means key=true
	return {
		key: s.trim(),
		op: "=",
		value: "true",
	};
}
