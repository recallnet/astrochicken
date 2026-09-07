import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { ensureFactoryTrackingIssue, type EnsureTrackingIssueOptions } from "./tracking-issue.js";

type ExecFn = typeof execFileSync;

const BASE_OPTIONS = {
	repo: "owner/repo",
	factoryId: "test-factory",
	controlPlaneRepo: "owner/control",
} satisfies Omit<EnsureTrackingIssueOptions, "execFileSyncFn">;

function makeExecFn(responses: Record<string, string | Error>): ExecFn {
	return ((cmd: string, args: string[]) => {
		const key = (args as string[]).includes("list") ? "list" : "create";
		const response = responses[key];
		if (response instanceof Error) throw response;
		return response as string;
	}) as unknown as ExecFn;
}

describe("ensureFactoryTrackingIssue", () => {
	describe("find existing issue", () => {
		it("returns existing issue with created: false", () => {
			const execFn = makeExecFn({
				list: JSON.stringify([
					{ title: "Factory Tracking: test-factory", url: "https://github.com/owner/repo/issues/42", number: 42 },
				]),
			});

			const result = ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn });

			expect(result).toEqual({
				url: "https://github.com/owner/repo/issues/42",
				number: 42,
				created: false,
			});
		});

		it("ignores non-matching titles and falls through to create", () => {
			const execFn = makeExecFn({
				list: JSON.stringify([
					{ title: "Factory Tracking: other-factory", url: "https://github.com/owner/repo/issues/10", number: 10 },
				]),
				create: "https://github.com/owner/repo/issues/99\n",
			});

			const result = ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn });

			expect(result).toEqual({
				url: "https://github.com/owner/repo/issues/99",
				number: 99,
				created: true,
			});
		});
	});

	describe("create new issue", () => {
		it("creates issue when none found and returns created: true", () => {
			const execFn = makeExecFn({
				list: "[]",
				create: "https://github.com/owner/repo/issues/7\n",
			});

			const result = ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn });

			expect(result).toEqual({
				url: "https://github.com/owner/repo/issues/7",
				number: 7,
				created: true,
			});
		});

		it("throws when create returns no URL", () => {
			const execFn = makeExecFn({
				list: "[]",
				create: "some random output with no url",
			});

			expect(() => ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn })).toThrow(
				"did not return issue URL",
			);
		});
	});

	describe("error handling", () => {
		it("throws on list query failure", () => {
			const execFn = makeExecFn({
				list: new Error("network timeout"),
			});

			expect(() => ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn })).toThrow(
				"failed to query tracking issues via gh: network timeout",
			);
		});

		it("throws on create failure", () => {
			const execFn = makeExecFn({
				list: "[]",
				create: new Error("permission denied"),
			});

			expect(() => ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn })).toThrow(
				"failed to create tracking issue via gh: permission denied",
			);
		});
	});

	describe("parseIssueUrl (via ensureFactoryTrackingIssue)", () => {
		it("parses valid /issues/N URL from list result", () => {
			const execFn = makeExecFn({
				list: JSON.stringify([
					{ title: "Factory Tracking: test-factory", url: "https://github.com/owner/repo/issues/123" },
				]),
			});

			const result = ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn });
			expect(result.number).toBe(123);
			expect(result.url).toBe("https://github.com/owner/repo/issues/123");
		});

		it("falls through to create when existing issue has invalid URL", () => {
			const execFn = makeExecFn({
				list: JSON.stringify([
					{ title: "Factory Tracking: test-factory", url: "https://github.com/owner/repo/issues/abc" },
				]),
				create: "https://github.com/owner/repo/issues/5\n",
			});

			const result = ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn });
			expect(result).toEqual({
				url: "https://github.com/owner/repo/issues/5",
				number: 5,
				created: true,
			});
		});

		it("falls through to create when existing issue has empty URL", () => {
			const execFn = makeExecFn({
				list: JSON.stringify([
					{ title: "Factory Tracking: test-factory", url: "" },
				]),
				create: "https://github.com/owner/repo/issues/3\n",
			});

			const result = ensureFactoryTrackingIssue({ ...BASE_OPTIONS, execFileSyncFn: execFn });
			expect(result.created).toBe(true);
		});
	});
});
