export type ComplexityClass = "low" | "medium" | "high";

export interface ComplexityEstimateInput {
	issue_title?: string;
	issue_body?: string;
	changed_files?: string[];
	estimated_lines_added?: number;
	estimated_lines_deleted?: number;
	estimated_file_count?: number;
	dependency_count?: number;
	blocked_by_count?: number;
	blocks_count?: number;
	qa_command?: string;
}

export interface ComplexitySignal {
	key: string;
	value: string;
	score: number;
	reason: string;
	unknown?: boolean;
}

export const COMPLEXITY_OTEL_CLASS_KEY = "hatch.complexity.class";

const SENSITIVE_PATH_PATTERNS: RegExp[] = [
	/^apps\/hatch\//i,
	/^docs\//i,
	/^packages\/tsconfig\//i,
	/^\.github\//i,
	/\bsecurity\b/i,
	/\bauth\b/i,
	/\binfra\b/i,
	/\bdeploy\b/i,
	/\bterraform\b/i,
	/\bdocker\b/i,
	/(^|\/)package-lock\.json$/i,
	/(^|\/)pnpm-lock\.yaml$/i,
	/(^|\/)yarn\.lock$/i,
];

const SENSITIVE_TEXT_PATTERNS: RegExp[] = [
	/\bci\//i,
	/\bsecurity\b/i,
	/\binfra\//i,
	/\bsrc\/config\//i,
	/\bapps\/hatch\//i,
	/\bdocs\//i,
	/\bpackages\/tsconfig\//i,
];

const SIDE_EFFECT_KEYWORDS: RegExp[] = [
	/\bdeploy(ment)?\b/i,
	/\bmigration\b/i,
	/\bdatabase\b/i,
	/\bproduction\b/i,
	/\bexternal\s+api\b/i,
	/\bapi\b/i,
	/\bterraform\b/i,
	/\bpayments?\b/i,
	/\binfrastructure\b/i,
];

const SIDE_EFFECT_PATH_PATTERNS: RegExp[] = [
	/\binfra\//i,
	/\bdeploy\//i,
	/\bterraform\//i,
	/\bmigrations?\//i,
	/\bapi\//i,
	/\bk8s\//i,
];

const TEST_COVERAGE_TEXT_PATTERNS: RegExp[] = [
	/\badd\s+tests?\b/i,
	/\bunit\s+tests?\b/i,
	/\bintegration\s+tests?\b/i,
	/\bfast-test\b/i,
	/\bregression\s+tests?\b/i,
	/\btest\s+coverage\b/i,
	/\bvitest\b/i,
	/\bjest\b/i,
];

export function normalizeComplexityInput(raw: unknown): ComplexityEstimateInput {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const value = raw as Record<string, unknown>;

	const changedFiles = readStringArray(
		value["changed_files"] ?? value["files"] ?? value["paths"] ?? value["diff_files"],
	);

	const dependencyList = readStringArray(value["dependencies"]);
	const blockedByList = readStringArray(value["blocked_by"]);
	const blocksList = readStringArray(value["blocks"]);

	const estimatedFileCount = readNumber(
		value["estimated_file_count"] ?? value["file_count"] ?? value["estimated_files"],
	);

	const dependencyCount = readNumber(value["dependency_count"]);
	const blockedByCount = readNumber(value["blocked_by_count"]);
	const blocksCount = readNumber(value["blocks_count"]);

	return {
		issue_title: readString(value["issue_title"] ?? value["title"]),
		issue_body: readString(value["issue_body"] ?? value["body"] ?? value["description"]),
		changed_files: changedFiles,
		estimated_lines_added: readNumber(value["estimated_lines_added"] ?? value["lines_added"]),
		estimated_lines_deleted: readNumber(value["estimated_lines_deleted"] ?? value["lines_deleted"]),
		estimated_file_count: estimatedFileCount,
		dependency_count: dependencyCount ?? (dependencyList.length > 0 ? dependencyList.length : undefined),
		blocked_by_count: blockedByCount ?? (blockedByList.length > 0 ? blockedByList.length : undefined),
		blocks_count: blocksCount ?? (blocksList.length > 0 ? blocksList.length : undefined),
		qa_command: readString(value["qa_command"] ?? value["test_command"]),
	};
}

export function signalDiffSize(input: ComplexityEstimateInput): ComplexitySignal {
	const added = input.estimated_lines_added;
	const deleted = input.estimated_lines_deleted;
	if (!Number.isFinite(added) && !Number.isFinite(deleted)) {
		const inferred = inferDiffSizeFromIssueText(issueText(input));
		if (inferred) return inferred;
		return {
			key: "diff_size",
			value: "unknown",
			score: 2,
			reason: "missing_line_estimate",
			unknown: true,
		};
	}
	const total = Math.max(0, Number(added || 0)) + Math.max(0, Number(deleted || 0));
	if (total <= 40) return { key: "diff_size", value: "small", score: 0, reason: `line_change_total=${total}` };
	if (total <= 200) return { key: "diff_size", value: "medium", score: 1, reason: `line_change_total=${total}` };
	return { key: "diff_size", value: "large", score: 2, reason: `line_change_total=${total}` };
}

export function signalFileCount(input: ComplexityEstimateInput): ComplexitySignal {
	const explicitCount = input.estimated_file_count;
	const inferredCount = input.changed_files?.length;
	const count = Number.isFinite(explicitCount)
		? Number(explicitCount)
		: Number.isFinite(inferredCount)
			? Number(inferredCount)
			: inferFileCountFromIssueText(issueText(input));
	if (!Number.isFinite(count)) {
		return {
			key: "file_count",
			value: "unknown",
			score: 2,
			reason: "missing_file_count",
			unknown: true,
		};
	}
	if ((count as number) <= 2) return { key: "file_count", value: "small", score: 0, reason: `files=${count}` };
	if ((count as number) <= 8) return { key: "file_count", value: "medium", score: 1, reason: `files=${count}` };
	return { key: "file_count", value: "large", score: 2, reason: `files=${count}` };
}

export function signalSensitivePaths(input: ComplexityEstimateInput): ComplexitySignal {
	const files = input.changed_files ?? [];
	if (files.length === 0) {
		const text = issueText(input);
		const textHit = text
			? SENSITIVE_TEXT_PATTERNS.find((pattern) => pattern.test(text))
			: undefined;
		if (textHit) {
			return {
				key: "sensitive_paths",
				value: "true",
				score: 2,
				reason: `matched_issue_text=${textHit.source}`,
			};
		}
		return {
			key: "sensitive_paths",
			value: "unknown",
			score: 1,
			reason: "missing_changed_files",
			unknown: true,
		};
	}
	const hit = files.find((file) => SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(file)));
	if (!hit) return { key: "sensitive_paths", value: "false", score: 0, reason: "no_sensitive_paths" };
	return { key: "sensitive_paths", value: "true", score: 2, reason: `matched=${hit}` };
}

export function signalSideEffects(input: ComplexityEstimateInput): ComplexitySignal {
	const files = input.changed_files ?? [];
	const pathHit = files.find((file) => SIDE_EFFECT_PATH_PATTERNS.some((pattern) => pattern.test(file)));
	if (pathHit) {
		return {
			key: "side_effect_keywords",
			value: "true",
			score: 2,
			reason: `matched_path=${pathHit}`,
		};
	}

	const text = issueText(input);
	if (!text) {
		if (files.length > 0) {
			return {
				key: "side_effect_keywords",
				value: "false",
				score: 0,
				reason: "no_side_effect_paths_or_keywords",
			};
		}
		return {
			key: "side_effect_keywords",
			value: "unknown",
			score: 1,
			reason: "missing_issue_text",
			unknown: true,
		};
	}
	const hit = SIDE_EFFECT_KEYWORDS.find((pattern) => pattern.test(text));
	if (!hit) return { key: "side_effect_keywords", value: "false", score: 0, reason: "no_side_effect_keywords" };
	return {
		key: "side_effect_keywords",
		value: "true",
		score: 2,
		reason: `matched=${hit.source}`,
	};
}

export function signalDependencyPressure(input: ComplexityEstimateInput): ComplexitySignal {
	const inferred = inferDependencyCountsFromIssueText(issueText(input));
	const dependencyCount = Number.isFinite(input.dependency_count)
		? Number(input.dependency_count)
		: inferred?.dependency_count;
	const blockedByCount = Number.isFinite(input.blocked_by_count)
		? Number(input.blocked_by_count)
		: inferred?.blocked_by_count;
	const blocksCount = Number.isFinite(input.blocks_count)
		? Number(input.blocks_count)
		: inferred?.blocks_count;

	if (
		!Number.isFinite(dependencyCount) &&
		!Number.isFinite(blockedByCount) &&
		!Number.isFinite(blocksCount)
	) {
		return {
			key: "dependency_pressure",
			value: "unknown",
			score: 1,
			reason: "missing_dependency_metadata",
			unknown: true,
		};
	}

	const total = Number(dependencyCount || 0) + Number(blockedByCount || 0) + Number(blocksCount || 0);
	if (total === 0) return { key: "dependency_pressure", value: "none", score: 0, reason: "dependency_total=0" };
	if (total <= 2) return { key: "dependency_pressure", value: "moderate", score: 1, reason: `dependency_total=${total}` };
	return { key: "dependency_pressure", value: "high", score: 2, reason: `dependency_total=${total}` };
}

export function signalQaCoverage(input: ComplexityEstimateInput): ComplexitySignal {
	const command = String(input.qa_command || "").trim();
	if (!command) {
		const text = issueText(input);
		const textHit = text
			? TEST_COVERAGE_TEXT_PATTERNS.find((pattern) => pattern.test(text))
			: undefined;
		if (textHit) {
			return {
				key: "qa_signal",
				value: "present_from_issue_text",
				score: -1,
				reason: `issue_text_test_signal=${textHit.source}`,
			};
		}
		return {
			key: "qa_signal",
			value: "missing",
			score: 1,
			reason: "missing_qa_command",
			unknown: true,
		};
	}
	const hasTestSignal = /\b(test|vitest|jest|turbo run test|npm test|pnpm test|yarn test)\b/i.test(command);
	if (hasTestSignal) {
		return {
			key: "qa_signal",
			value: "present",
			score: -1,
			reason: "qa_command_indicates_test_coverage",
		};
	}
	return {
		key: "qa_signal",
		value: "present_non_test",
		score: 0,
		reason: "qa_command_present_without_explicit_test_signal",
	};
}

export function allComplexitySignals(input: ComplexityEstimateInput): ComplexitySignal[] {
	return [
		signalDiffSize(input),
		signalFileCount(input),
		signalSensitivePaths(input),
		signalSideEffects(input),
		signalDependencyPressure(input),
		signalQaCoverage(input),
	];
}

function issueText(input: ComplexityEstimateInput): string {
	return [input.issue_title || "", input.issue_body || ""].join("\n").trim();
}

function inferDiffSizeFromIssueText(text: string): ComplexitySignal | undefined {
	if (!text) return undefined;

	const explicitLineEstimate = text.match(/\b(\d+)\s+(?:lines?|loc)\b/i);
	if (explicitLineEstimate) {
		const total = Number(explicitLineEstimate[1] || 0);
		if (!Number.isFinite(total)) return undefined;
		if (total <= 40) return { key: "diff_size", value: "small", score: 0, reason: `line_change_total=${total}` };
		if (total <= 200) return { key: "diff_size", value: "medium", score: 1, reason: `line_change_total=${total}` };
		return { key: "diff_size", value: "large", score: 2, reason: `line_change_total=${total}` };
	}

	const diffLikeLineCount = [...text.matchAll(/(?:^|\n)\s*[+-](?![+-])[^\n]*/g)].length;
	if (diffLikeLineCount > 0) {
		if (diffLikeLineCount <= 40) {
			return { key: "diff_size", value: "small", score: 0, reason: `line_change_total=${diffLikeLineCount}` };
		}
		if (diffLikeLineCount <= 200) {
			return { key: "diff_size", value: "medium", score: 1, reason: `line_change_total=${diffLikeLineCount}` };
		}
		return { key: "diff_size", value: "large", score: 2, reason: `line_change_total=${diffLikeLineCount}` };
	}

	if (/\b(large|major|sweeping|overhaul|rewrite)\b/i.test(text)) {
		return { key: "diff_size", value: "large", score: 2, reason: "issue_text_scope=large_change" };
	}
	if (/\b(refactor|modify|module|scope|update|migration)\b/i.test(text)) {
		return { key: "diff_size", value: "medium", score: 1, reason: "issue_text_scope=moderate_change" };
	}
	if (/\b(tiny|small|minor|typo|docs?)\b/i.test(text)) {
		return { key: "diff_size", value: "small", score: 0, reason: "issue_text_scope=small_change" };
	}

	return undefined;
}

function inferFileCountFromIssueText(text: string): number | undefined {
	if (!text) return undefined;

	const explicitFileCount = text.match(/\b(\d+)\s+files?\b/i);
	if (explicitFileCount) {
		const count = Number(explicitFileCount[1] || 0);
		if (Number.isFinite(count)) return count;
	}

	const uniquePaths = new Set(
		[...text.matchAll(/(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/g)].map((match) => String(match[1] || "").trim()),
	);
	const pathCount = [...uniquePaths].filter(Boolean).length;
	if (pathCount > 0) return pathCount;

	if (/\b(single\s+file|one\s+file)\b/i.test(text)) return 1;
	if (/\b(multi[-\s]?file|across\s+modules?)\b/i.test(text)) return 5;

	return undefined;
}

function inferDependencyCountsFromIssueText(text: string):
	| { dependency_count?: number; blocked_by_count?: number; blocks_count?: number }
	| undefined {
	if (!text) return undefined;

	if (/\b(no\s+dependencies|no\s+blockers?|not\s+blocked)\b/i.test(text)) {
		return { dependency_count: 0, blocked_by_count: 0, blocks_count: 0 };
	}

	const lines = text.split(/\r?\n/);
	let blockedByCount = 0;
	let blocksCount = 0;
	let dependencyCount = 0;

	for (const line of lines) {
		const refs = (line.match(/#\d+/g) || []).length;
		if (refs === 0) continue;
		if (/blocked[\s-]*by/i.test(line)) {
			blockedByCount += refs;
			continue;
		}
		if (/\bblocks?\b/i.test(line)) {
			blocksCount += refs;
			continue;
		}
		if (/\bdepends?\s+on\b/i.test(line) || /\bdependencies?\b/i.test(line)) {
			dependencyCount += refs;
		}
	}

	if (blockedByCount === 0 && blocksCount === 0 && dependencyCount === 0) return undefined;
	return {
		dependency_count: dependencyCount,
		blocked_by_count: blockedByCount,
		blocks_count: blocksCount,
	};
}

function readString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function readStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry || "").trim()).filter(Boolean);
	}
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
		}
	} catch {
		// fall through
	}
	return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function readNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}
