import { describe, expect, it, vi } from "vitest";

const {
	scanRuntimeRecoverySweepMock,
	applyRuntimeRecoverySweepMock,
} = vi.hoisted(() => ({
	scanRuntimeRecoverySweepMock: vi.fn(() => ({
		schemaVersion: "hatch.runtime.recovery-sweep.v1",
		stats: {
			staleRunCount: 0,
			unresolvedActiveChildRefCount: 0,
			orphanedWorktreeCount: 0,
			orphanedBranchCount: 0,
			safeActionCount: 0,
		},
	})),
	applyRuntimeRecoverySweepMock: vi.fn(() => ({ ok: true, appliedCount: 0, failedCount: 0 })),
}));

vi.mock("./runs-recovery-sweep.js", () => ({
	scanRuntimeRecoverySweep: scanRuntimeRecoverySweepMock,
	applyRuntimeRecoverySweep: applyRuntimeRecoverySweepMock,
}));

import { cmdRuns } from "./runs.js";

describe("runs recovery-sweep CLI contract", () => {
	it("forwards --skip-worktree-scan to the recovery sweep engine", async () => {
		const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true as any);

		try {
			await cmdRuns([
				"recovery-sweep",
				"--repo=/tmp/repo",
				"--runs-dir=/tmp/runs",
				"--skip-worktree-scan",
				"--json",
			]);
		} finally {
			stdout.mockRestore();
		}

		expect(scanRuntimeRecoverySweepMock).toHaveBeenCalledTimes(1);
		expect(scanRuntimeRecoverySweepMock.mock.calls[0]?.[0]).toMatchObject({
			repoPath: "/tmp/repo",
			runsDir: "/tmp/runs",
			skipWorktreeScan: true,
		});
	});
});
