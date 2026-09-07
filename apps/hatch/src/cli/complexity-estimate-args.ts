import { existsSync, readFileSync } from "node:fs";

export interface ComplexityEstimateArgs {
	input?: string;
	issueTitle?: string;
	issueBody?: string;
	changedFiles?: string;
	dependencies?: string;
	blockedBy?: string;
	blocks?: string;
	estimatedLinesAdded?: number;
	estimatedLinesDeleted?: number;
	estimatedFileCount?: number;
	dependencyCount?: number;
	blockedByCount?: number;
	blocksCount?: number;
	qaCommand?: string;
}

export interface ComplexityEstimateArgError {
	message: string;
	usage: string;
	exitCode: number;
}

export type ComplexityEstimateArgParseResult =
	| { ok: true; value: ComplexityEstimateArgs }
	| { ok: false; error: ComplexityEstimateArgError };

export const COMPLEXITY_ESTIMATE_USAGE =
	"usage: hatch complexity estimate [--input <json|file>] [--issue-title <text>] [--issue-body <text>] [--changed-files <json-array|csv>] [--dependencies <json-array|csv>] [--blocked-by <json-array|csv>] [--blocks <json-array|csv>] [--estimated-lines-added <n>] [--estimated-lines-deleted <n>] [--estimated-file-count <n>] [--dependency-count <n>] [--blocked-by-count <n>] [--blocks-count <n>] [--qa-command <cmd>]";

export function parseComplexityEstimateArgs(args: string[]): ComplexityEstimateArgParseResult {
	const out: ComplexityEstimateArgs = {};
	const positionals: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}

		if (arg === "--input" || arg.startsWith("--input=")) {
			const value = readFlagValue(args, arg, i, "--input");
			if (!value.ok) return value;
			out.input = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--issue-title" || arg.startsWith("--issue-title=")) {
			const value = readFlagValue(args, arg, i, "--issue-title");
			if (!value.ok) return value;
			out.issueTitle = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--issue-body" || arg.startsWith("--issue-body=")) {
			const value = readFlagValue(args, arg, i, "--issue-body");
			if (!value.ok) return value;
			out.issueBody = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--changed-files" || arg.startsWith("--changed-files=")) {
			const value = readFlagValue(args, arg, i, "--changed-files");
			if (!value.ok) return value;
			out.changedFiles = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--dependencies" || arg.startsWith("--dependencies=")) {
			const value = readFlagValue(args, arg, i, "--dependencies");
			if (!value.ok) return value;
			out.dependencies = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--blocked-by" || arg.startsWith("--blocked-by=")) {
			const value = readFlagValue(args, arg, i, "--blocked-by");
			if (!value.ok) return value;
			out.blockedBy = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--blocks" || arg.startsWith("--blocks=")) {
			const value = readFlagValue(args, arg, i, "--blocks");
			if (!value.ok) return value;
			out.blocks = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--qa-command" || arg.startsWith("--qa-command=")) {
			const value = readFlagValue(args, arg, i, "--qa-command");
			if (!value.ok) return value;
			out.qaCommand = value.value;
			i = value.nextIndex;
			continue;
		}

		if (arg === "--estimated-lines-added" || arg.startsWith("--estimated-lines-added=")) {
			const value = readNumericValue(args, arg, i, "--estimated-lines-added");
			if (!value.ok) return value;
			out.estimatedLinesAdded = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--estimated-lines-deleted" || arg.startsWith("--estimated-lines-deleted=")) {
			const value = readNumericValue(args, arg, i, "--estimated-lines-deleted");
			if (!value.ok) return value;
			out.estimatedLinesDeleted = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--estimated-file-count" || arg.startsWith("--estimated-file-count=")) {
			const value = readNumericValue(args, arg, i, "--estimated-file-count");
			if (!value.ok) return value;
			out.estimatedFileCount = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--dependency-count" || arg.startsWith("--dependency-count=")) {
			const value = readNumericValue(args, arg, i, "--dependency-count");
			if (!value.ok) return value;
			out.dependencyCount = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--blocked-by-count" || arg.startsWith("--blocked-by-count=")) {
			const value = readNumericValue(args, arg, i, "--blocked-by-count");
			if (!value.ok) return value;
			out.blockedByCount = value.value;
			i = value.nextIndex;
			continue;
		}
		if (arg === "--blocks-count" || arg.startsWith("--blocks-count=")) {
			const value = readNumericValue(args, arg, i, "--blocks-count");
			if (!value.ok) return value;
			out.blocksCount = value.value;
			i = value.nextIndex;
			continue;
		}

		return {
			ok: false,
			error: {
				message: `complexity estimate: unknown option: ${arg}`,
				usage: COMPLEXITY_ESTIMATE_USAGE,
				exitCode: 1,
			},
		};
	}

	if (positionals.length > 1) {
		return {
			ok: false,
			error: {
				message: "complexity estimate: expected zero or one positional JSON input",
				usage: COMPLEXITY_ESTIMATE_USAGE,
				exitCode: 1,
			},
		};
	}
	if (!out.input && positionals.length === 1) out.input = positionals[0];

	return { ok: true, value: out };
}

export function loadComplexityInput(args: ComplexityEstimateArgs): unknown {
	const base = loadInputBlob(args.input);
	const obj = asObject(base);

	if (args.issueTitle !== undefined) obj.issue_title = args.issueTitle;
	if (args.issueBody !== undefined) obj.issue_body = args.issueBody;
	if (args.changedFiles !== undefined) obj.changed_files = parseStringList(args.changedFiles);
	if (args.dependencies !== undefined) obj.dependencies = parseStringList(args.dependencies);
	if (args.blockedBy !== undefined) obj.blocked_by = parseStringList(args.blockedBy);
	if (args.blocks !== undefined) obj.blocks = parseStringList(args.blocks);
	if (args.estimatedLinesAdded !== undefined) obj.estimated_lines_added = args.estimatedLinesAdded;
	if (args.estimatedLinesDeleted !== undefined) obj.estimated_lines_deleted = args.estimatedLinesDeleted;
	if (args.estimatedFileCount !== undefined) obj.estimated_file_count = args.estimatedFileCount;
	if (args.dependencyCount !== undefined) obj.dependency_count = args.dependencyCount;
	if (args.blockedByCount !== undefined) obj.blocked_by_count = args.blockedByCount;
	if (args.blocksCount !== undefined) obj.blocks_count = args.blocksCount;
	if (args.qaCommand !== undefined) obj.qa_command = args.qaCommand;

	return obj;
}

function loadInputBlob(input?: string): unknown {
	const inline = String(input || "").trim();
	if (!inline) return {};
	if ((inline.startsWith("{") && inline.endsWith("}")) || (inline.startsWith("[") && inline.endsWith("]"))) {
		return parseJsonOrThrow(inline, "complexity estimate: input JSON parse failed");
	}
	if (existsSync(inline)) {
		const raw = readFileSync(inline, "utf8");
		return parseJsonOrThrow(raw, `complexity estimate: input file JSON parse failed: ${inline}`);
	}
	return parseJsonOrThrow(inline, "complexity estimate: input JSON parse failed");
}

function parseJsonOrThrow(raw: string, message: string): unknown {
	try {
		return JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`${message}: ${detail}`);
	}
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return { ...(value as Record<string, unknown>) };
}

function parseStringList(raw: string): string[] {
	const trimmed = String(raw || "").trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("[")) {
		const parsed = parseJsonOrThrow(trimmed, "complexity estimate: changed-files JSON parse failed");
		if (!Array.isArray(parsed)) {
			throw new Error("complexity estimate: --changed-files JSON must be an array");
		}
		return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
	}
	return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function readFlagValue(
	args: string[],
	arg: string,
	index: number,
	flag: string,
):
	| { ok: true; value: string; nextIndex: number }
	| { ok: false; error: ComplexityEstimateArgError } {
	if (arg.startsWith(`${flag}=`)) {
		return { ok: true, value: arg.slice(flag.length + 1), nextIndex: index };
	}
	if (index + 1 >= args.length) {
		return {
			ok: false,
			error: {
				message: `complexity estimate: ${flag} requires a value`,
				usage: COMPLEXITY_ESTIMATE_USAGE,
				exitCode: 1,
			},
		};
	}
	return { ok: true, value: args[index + 1], nextIndex: index + 1 };
}

function readNumericValue(
	args: string[],
	arg: string,
	index: number,
	flag: string,
):
	| { ok: true; value: number; nextIndex: number }
	| { ok: false; error: ComplexityEstimateArgError } {
	const value = readFlagValue(args, arg, index, flag);
	if (!value.ok) return value;
	const n = Number(value.value);
	if (!Number.isFinite(n)) {
		return {
			ok: false,
			error: {
				message: `complexity estimate: ${flag} expects a number`,
				usage: COMPLEXITY_ESTIMATE_USAGE,
				exitCode: 1,
			},
		};
	}
	return { ok: true, value: n, nextIndex: value.nextIndex };
}
