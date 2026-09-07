import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	acquireLock,
	isLocked,
	leaseArtifactsDirPath,
	leaseEventsPath,
	leasePath,
	readLease,
	sweepLeases,
	type LeaseRecord,
} from "../lock.js";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function busyWait(ms: number): void {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		/* intentionally block */
	}
}

function writeLease(record: LeaseRecord): void {
	const path = leasePath(record.leaseName);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(record, null, 2));
}

function staleLease(name: string, now: Date, generation = 1): LeaseRecord {
	const heartbeatAt = new Date(now.getTime() - 10_000).toISOString();
	return {
		schemaVersion: 1,
		leaseName: name,
		status: "active",
		ownerId: `${name}-dead-owner`,
		hostId: "test-host",
		pid: null,
		generation,
		acquiredAt: heartbeatAt,
		heartbeatAt,
		heartbeatIntervalMs: 25,
		ttlMs: 200,
		expiresAt: new Date(now.getTime() - 1_000).toISOString(),
		updatedAt: heartbeatAt,
	};
}

function pidDeadLease(name: string, now: Date, hostId: string, generation = 1): LeaseRecord {
	const heartbeatAt = new Date(now.getTime() - 100).toISOString();
	return {
		schemaVersion: 1,
		leaseName: name,
		status: "active",
		ownerId: `${name}-dead-pid`,
		hostId,
		pid: 999_999,
		generation,
		acquiredAt: heartbeatAt,
		heartbeatAt,
		heartbeatIntervalMs: 100,
		ttlMs: 10_000,
		expiresAt: new Date(now.getTime() + 9_900).toISOString(),
		updatedAt: heartbeatAt,
	};
}

async function runContender(options: {
	modulePath: string;
	lockDir: string;
	leaseName: string;
	ownerId: string;
	hostId: string;
	startFile: string;
	releaseFile: string;
	readyFile: string;
	doneFile: string;
}): Promise<string> {
	const script = `
		const [modulePath, leaseName, ownerId, hostId, startFile, releaseFile, readyFile, doneFile] = process.argv.slice(1);
		const { existsSync, writeFileSync } = await import("node:fs");
		writeFileSync(readyFile, "ready");
		while (!existsSync(startFile)) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		const { acquireLock } = await import(modulePath);
		const release = acquireLock(leaseName, 0, { ownerId, hostId, heartbeatMs: 50, ttlMs: 2000 });
		if (!release) {
			writeFileSync(doneFile, "done");
			process.stdout.write("miss:" + ownerId);
			process.exit(0);
		}

		writeFileSync(doneFile, "done");
		process.stdout.write("acquired:" + ownerId);
		while (!existsSync(releaseFile)) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		release();
		process.exit(0);
	`;

	return await new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				script,
				options.modulePath,
				options.leaseName,
				options.ownerId,
				options.hostId,
				options.startFile,
				options.releaseFile,
				options.readyFile,
				options.doneFile,
			],
			{
				env: { ...process.env, HATCH_LOCK_DIR: options.lockDir },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code !== 0) {
				reject(new Error(`contender failed (code=${code ?? "null"}, signal=${signal ?? "none"}): ${stderr}`));
				return;
			}
			resolve(stdout.trim());
		});
	});
}

async function waitForReadyFiles(paths: string[], timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (paths.every((path) => existsSync(path))) return;
		await sleep(5);
	}
	throw new Error(`timed out waiting for ready files: ${paths.join(", ")}`);
}

describe("lock lease heartbeat + TTL reclaim", () => {
	let root: string;
	let previousLockDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-lock-"));
		previousLockDir = process.env["HATCH_LOCK_DIR"];
		process.env["HATCH_LOCK_DIR"] = join(root, "locks");
	});

	afterEach(() => {
		if (previousLockDir === undefined) delete process.env["HATCH_LOCK_DIR"];
		else process.env["HATCH_LOCK_DIR"] = previousLockDir;
		rmSync(root, { recursive: true, force: true });
	});

	it("refreshes heartbeat before TTL expiry under normal operation", async () => {
		const release = acquireLock("heartbeat", 0, {
			ownerId: "owner-heartbeat",
			hostId: "test-host",
			heartbeatMs: 20,
			ttlMs: 120,
		});
		expect(release).not.toBeNull();

		const first = readLease("heartbeat");
		expect(first?.status).toBe("active");

		await sleep(80);
		const second = readLease("heartbeat");
		expect(second?.status).toBe("active");
		expect(Date.parse(second?.heartbeatAt || "")).toBeGreaterThan(Date.parse(first?.heartbeatAt || ""));
		expect(Date.parse(second?.expiresAt || "")).toBeGreaterThan(Date.parse(second?.heartbeatAt || ""));

		release?.();
		expect(readLease("heartbeat")).toBeNull();
	});

	it("keeps live lease ownership untouched while rejecting contenders", async () => {
		const holder = acquireLock("live", 0, {
			ownerId: "owner-live",
			hostId: "host-a",
			heartbeatMs: 20,
			ttlMs: 140,
		});
		expect(holder).not.toBeNull();
		await sleep(30);

		const contender = acquireLock("live", 0, {
			ownerId: "owner-contender",
			hostId: "host-b",
			heartbeatMs: 20,
			ttlMs: 140,
		});
		expect(contender).toBeNull();
		expect(readLease("live")?.ownerId).toBe("owner-live");

		holder?.();
	});

	it("reclaims dead stale lease deterministically and emits structured reclaim events/artifacts", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		writeLease(staleLease("dead", now, 7));

		const release = acquireLock("dead", 0, {
			ownerId: "owner-new",
			hostId: "test-host",
			heartbeatMs: 20,
			ttlMs: 150,
		});
		expect(release).not.toBeNull();
		expect(readLease("dead")?.ownerId).toBe("owner-new");
		expect(readLease("dead")?.generation).toBe(8);

		const artifacts = existsSync(leaseArtifactsDirPath()) ? readdirSync(leaseArtifactsDirPath()) : [];
		expect(artifacts.some((name) => name.includes("dead.lease_reclaim"))).toBe(true);

		const eventsRaw = readFileSync(leaseEventsPath(), "utf-8").trim().split("\n").filter(Boolean);
		const events = eventsRaw.map((line) => JSON.parse(line) as { event: string; leaseName: string });
		expect(events.some((event) => event.event === "lease_stale" && event.leaseName === "dead")).toBe(true);
		expect(events.some((event) => event.event === "lease_reclaimed" && event.leaseName === "dead")).toBe(true);

		release?.();
	});

	it("reclaims pid-dead lease during host-simulated sweep even when TTL is still in range", () => {
		const now = new Date("2026-01-03T00:00:00.000Z");
		writeLease(pidDeadLease("pid-dead", now, "sim-host", 4));

		const sweep = sweepLeases({ now: new Date(now.getTime() + 50), hostId: "sim-host" });
		expect(sweep.reclaimed).toBe(1);
		expect(sweep.reclaimedLeases[0]?.leaseName).toBe("pid-dead");
		expect(sweep.reclaimedLeases[0]?.reason).toBe("pid_dead");
		expect(readLease("pid-dead")).toBeNull();
	});

	it("transitions lease to stale when heartbeat misses TTL under scheduler stall", async () => {
		const release = acquireLock("ttl-stall", 0, {
			ownerId: "owner-ttl-stall",
			hostId: "test-host",
			heartbeatMs: 20,
			ttlMs: 90,
		});
		expect(release).not.toBeNull();

		busyWait(180);
		await sleep(40);
		expect(isLocked("ttl-stall")).toBe(false);

		release?.();
	});

	it("sweep reconciles stale metadata after restart and allows clean reacquire", () => {
		const now = new Date("2026-01-02T00:00:00.000Z");
		writeLease(staleLease("restart", now, 3));

		const sweep = sweepLeases({ now: new Date(now.getTime() + 10_000), hostId: "test-host" });
		expect(sweep.reclaimed).toBe(1);
		expect(sweep.reclaimedLeases[0]?.leaseName).toBe("restart");
		expect(isLocked("restart")).toBe(false);

		const reacquire = acquireLock("restart", 0, {
			ownerId: "owner-restart",
			hostId: "test-host",
			heartbeatMs: 20,
			ttlMs: 120,
		});
		expect(reacquire).not.toBeNull();
		reacquire?.();
	});

	it("host-simulated contention yields a single winner across repeated stale handoffs", () => {
		for (let round = 0; round < 20; round++) {
			writeLease(staleLease("stress", new Date(), round + 1));

			let winnerCount = 0;
			let winnerRelease: (() => void) | null = null;
			for (let contender = 0; contender < 8; contender++) {
				const release = acquireLock("stress", 0, {
					ownerId: `owner-${round}-${contender}`,
					hostId: `host-${contender}`,
					heartbeatMs: 20,
					ttlMs: 150,
				});
				if (!release) continue;
				winnerCount += 1;
				if (!winnerRelease) winnerRelease = release;
				else release();
			}

			expect(winnerCount).toBe(1);
			winnerRelease?.();
		}
	});

	it("multi-process contention keeps a single winner per stale handoff round", async () => {
		const modulePath = fileURLToPath(new URL("../lock.ts", import.meta.url));
		const lockDir = process.env["HATCH_LOCK_DIR"] || "";
		expect(lockDir).not.toBe("");

		for (let round = 0; round < 3; round++) {
			const leaseName = `multi-${round}`;
			writeLease(staleLease(leaseName, new Date(), round + 1));

			const startFile = join(root, `start-${round}.flag`);
			const releaseFile = join(root, `release-${round}.flag`);
			const readyFiles = Array.from({ length: 4 }, (_, contender) => join(root, `ready-${round}-${contender}.flag`));
			const doneFiles = Array.from({ length: 4 }, (_, contender) => join(root, `done-${round}-${contender}.flag`));
			const contenderRuns = Array.from({ length: 4 }, (_, contender) =>
				runContender({
					modulePath,
					lockDir,
					leaseName,
					ownerId: `mp-owner-${round}-${contender}`,
					hostId: `mp-host-${contender}`,
					startFile,
					releaseFile,
					readyFile: readyFiles[contender],
					doneFile: doneFiles[contender],
				}),
			);

			await waitForReadyFiles(readyFiles, 15_000);
			writeFileSync(startFile, "go");
			await waitForReadyFiles(doneFiles, 15_000);
			writeFileSync(releaseFile, "release");
			const results = await Promise.all(contenderRuns);

			const winners = results.filter((result) => result.startsWith("acquired:"));
			const eventLines = existsSync(leaseEventsPath())
				? readFileSync(leaseEventsPath(), "utf-8")
						.trim()
						.split("\n")
						.filter(Boolean)
						.map((line) => JSON.parse(line) as { leaseName?: string; event?: string; ownerId?: string; reason?: string })
						.filter((entry) => entry.leaseName === leaseName)
				: [];
			expect(winners, `results=${JSON.stringify(results)} events=${JSON.stringify(eventLines)}`).toHaveLength(1);
		}
	});
});
