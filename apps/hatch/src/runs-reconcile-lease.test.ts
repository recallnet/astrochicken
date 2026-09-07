import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { leaseEventsPath, leasePath, readLease, type LeaseRecord } from "./pipeline/lock.js";
import { configureRunStorageScope } from "./pipeline/run.js";
import { cmdRuns } from "./runs.js";

function writeStaleLease(name: string, now: Date): void {
	const heartbeatAt = new Date(now.getTime() - 10_000).toISOString();
	const lease: LeaseRecord = {
		schemaVersion: 1,
		leaseName: name,
		status: "active",
		ownerId: `${name}-dead-owner`,
		hostId: "test-host",
		pid: null,
		generation: 3,
		acquiredAt: heartbeatAt,
		heartbeatAt,
		heartbeatIntervalMs: 25,
		ttlMs: 200,
		expiresAt: new Date(now.getTime() - 1_000).toISOString(),
		updatedAt: heartbeatAt,
	};

	const path = leasePath(name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(lease, null, 2));
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk));
		return true;
	}) as typeof process.stdout.write);

	try {
		await run();
	} finally {
		spy.mockRestore();
	}

	return chunks.join("");
}

describe("hatch runs reconcile lease sweep integration", () => {
	let root: string;
	let runsDir: string;
	let previousLockDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-runs-reconcile-"));
		runsDir = join(root, ".hatch", "runs");
		mkdirSync(runsDir, { recursive: true });
		configureRunStorageScope({ runsDir });
		previousLockDir = process.env["HATCH_LOCK_DIR"];
		process.env["HATCH_LOCK_DIR"] = join(root, ".hatch", "locks");
	});

	afterEach(() => {
		if (previousLockDir === undefined) delete process.env["HATCH_LOCK_DIR"];
		else process.env["HATCH_LOCK_DIR"] = previousLockDir;
		rmSync(root, { recursive: true, force: true });
	});

	it("sweeps stale leases during reconcile and returns structured leaseSweep JSON", async () => {
		writeStaleLease("reconcile-stale", new Date("2026-01-05T00:00:00.000Z"));

		const output = await captureStdout(async () => {
			await cmdRuns(["reconcile", "--json", "--abandon-seconds=0"]);
		});

		const payload = JSON.parse(output) as {
			leaseSweep: {
				reclaimed: number;
				reclaimedLeases: Array<{ leaseName: string; reason: string; artifactPath: string }>;
				sweepArtifactPath: string;
			};
		};
		expect(payload.leaseSweep.reclaimed).toBe(1);
		expect(payload.leaseSweep.reclaimedLeases[0]?.leaseName).toBe("reconcile-stale");
		expect(payload.leaseSweep.reclaimedLeases[0]?.reason).toBe("heartbeat_ttl_exceeded");
		expect(existsSync(payload.leaseSweep.reclaimedLeases[0]?.artifactPath || "")).toBe(true);
		expect(existsSync(payload.leaseSweep.sweepArtifactPath)).toBe(true);
		expect(readLease("reconcile-stale")).toBeNull();

		const events = readFileSync(leaseEventsPath(), "utf-8").trim().split("\n").filter(Boolean);
		expect(events.some((line) => JSON.parse(line).event === "lease_sweep")).toBe(true);
	});

	it("supports deterministic skip via --no-lease-sweep", async () => {
		writeStaleLease("skip-stale", new Date("2026-01-06T00:00:00.000Z"));

		const output = await captureStdout(async () => {
			await cmdRuns(["reconcile", "--json", "--abandon-seconds=0", "--no-lease-sweep"]);
		});

		const payload = JSON.parse(output) as { leaseSweep: null };
		expect(payload.leaseSweep).toBeNull();
		expect(readLease("skip-stale")?.ownerId).toBe("skip-stale-dead-owner");
	});
});
