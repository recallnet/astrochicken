import { execFileSync } from "node:child_process";

export interface TrackingIssueResult {
	url: string;
	number: number;
	created: boolean;
}

export interface EnsureTrackingIssueOptions {
	repo: string;
	factoryId: string;
	controlPlaneRepo: string;
	execFileSyncFn?: typeof execFileSync;
}

function parseIssueUrl(url: string): { url: string; number: number } | null {
	const trimmed = String(url || "").trim();
	if (!trimmed) return null;
	const last = trimmed.split("/").pop() || "";
	const number = Number(last);
	if (!Number.isInteger(number) || number <= 0) return null;
	return { url: trimmed, number };
}

export function ensureFactoryTrackingIssue(options: EnsureTrackingIssueOptions): TrackingIssueResult {
	const execFn = options.execFileSyncFn ?? execFileSync;
	const title = `Factory Tracking: ${options.factoryId}`;

	try {
		const listedRaw = execFn(
			"gh",
			[
				"issue",
				"list",
				"--repo",
				options.repo,
				"--state",
				"open",
				"--label",
				"factory-tracking",
				"--json",
				"number,title,url",
			],
			{ encoding: "utf8" },
		);
		const listed = JSON.parse(String(listedRaw || "[]")) as Array<Record<string, unknown>>;
		const match = listed.find((issue) => String(issue.title || "").trim() === title);
		if (match) {
			const parsed = parseIssueUrl(String(match.url || ""));
			if (parsed) {
				return { ...parsed, created: false };
			}
		}
	} catch (err) {
		throw new Error(`failed to query tracking issues via gh: ${err instanceof Error ? err.message : String(err)}`);
	}

	const body = [
		`Factory: ${options.factoryId}`,
		`Target repo: ${options.repo}`,
		`Control plane: ${options.controlPlaneRepo}`,
		"",
		"This issue tracks distributed lease state and daemon ownership for the factory.",
	].join("\n");

	try {
		const createdRaw = execFn(
			"gh",
			[
				"issue",
				"create",
				"--repo",
				options.repo,
				"--label",
				"factory-tracking",
				"--title",
				title,
				"--body",
				body,
			],
			{ encoding: "utf8" },
		);
		const parsed = parseIssueUrl(String(createdRaw || "").split(/\s+/).find((token) => token.includes("/issues/")) || "");
		if (!parsed) {
			throw new Error(`gh issue create did not return issue URL: ${String(createdRaw || "").trim()}`);
		}
		return { ...parsed, created: true };
	} catch (err) {
		throw new Error(`failed to create tracking issue via gh: ${err instanceof Error ? err.message : String(err)}`);
	}
}
