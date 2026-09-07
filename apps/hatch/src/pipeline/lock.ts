import { randomBytes } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

const LEASE_SCHEMA_VERSION = 1;
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_TTL_MS = 30_000;
const WAIT_SLICE_MS = 100;
const PARSE_RETRY_ATTEMPTS = 3;
const PARSE_RETRY_DELAY_MS = 5;
const RECLAIM_CLAIM_TTL_MS = 30_000;

/**
 * Lease status lifecycle.
 *
 * active      -> owner heartbeats are arriving and expiry is in the future.
 * stale       -> heartbeat deadline exceeded, PID dead (same host), or metadata invalid.
 * released    -> owner intentionally released lock.
 * unavailable -> holder lost ownership unexpectedly (observability marker).
 */
export type LeaseStatus = "active" | "stale" | "released" | "unavailable";
export type LeaseStaleReason = "heartbeat_ttl_exceeded" | "pid_dead" | "non_active_state" | "corrupt_record";

/**
 * Durable lease contract written to ~/.hatch/locks/*.lock.
 *
 * Contract:
 * - heartbeatAt is refreshed every heartbeatIntervalMs while the holder is healthy.
 * - expiresAt MUST always be heartbeatAt + ttlMs.
 * - once now >= expiresAt, lease is stale and is never considered active.
 * - generation increments on each reclaim handoff.
 */
export interface LeaseRecord {
	schemaVersion: 1;
	leaseName: string;
	status: LeaseStatus;
	ownerId: string;
	hostId: string;
	pid: number | null;
	generation: number;
	acquiredAt: string;
	heartbeatAt: string;
	heartbeatIntervalMs: number;
	ttlMs: number;
	expiresAt: string;
	updatedAt: string;
	staleReason?: LeaseStaleReason;
}

export type LeaseEventType =
	| "lease_acquired"
	| "lease_stale"
	| "lease_reclaimed"
	| "lease_released"
	| "lease_lost"
	| "lease_unavailable"
	| "lease_sweep";

export interface LeaseEventRecord {
	schemaVersion: 1;
	ts: string;
	event: LeaseEventType;
	leaseName: string;
	ownerId?: string;
	previousOwnerId?: string;
	generation?: number;
	reason?: LeaseStaleReason;
	artifactPath?: string;
	detail?: Record<string, string | number | boolean | null>;
}

export interface AcquireLockOptions {
	heartbeatMs?: number;
	ttlMs?: number;
	ownerId?: string;
	hostId?: string;
}

export interface LeaseSweepOptions {
	now?: Date;
	hostId?: string;
}

export interface LeaseSweepEntry {
	leaseName: string;
	reason: LeaseStaleReason;
	previousOwnerId?: string;
	artifactPath: string;
}

export interface LeaseSweepResult {
	scanned: number;
	active: number;
	reclaimed: number;
	reclaimedLeases: LeaseSweepEntry[];
	sweepArtifactPath: string;
}

interface ReclaimResult {
	reclaimed: boolean;
	reason: LeaseStaleReason;
	previousOwnerId?: string;
	artifactPath?: string;
	generationHint?: number;
}

interface ReclaimClaim {
	release: () => void;
}

interface LeaseEvaluation {
	state: "active" | "stale";
	reason?: LeaseStaleReason;
}

/** Resolve lock root directory. Can be overridden for tests/ops via HATCH_LOCK_DIR. */
export function lockDirPath(): string {
	const configured = String(process.env["HATCH_LOCK_DIR"] || "").trim();
	if (configured) return configured;
	return join(homedir(), ".hatch", "locks");
}

/** Structured reclaim artifacts directory. */
export function leaseArtifactsDirPath(): string {
	return join(lockDirPath(), "artifacts");
}

/** JSONL event stream for lease actions/reclaims. */
export function leaseEventsPath(): string {
	return join(lockDirPath(), "lease-events.jsonl");
}

/** Resolve lock file path for a lease name. */
export function leasePath(name: string): string {
	return join(lockDirPath(), `${sanitize(name)}.lock`);
}

/** Read raw lease metadata for observability/testing. */
export function readLease(name: string): LeaseRecord | null {
	const lockFile = leasePath(name);
	const raw = readLeaseRaw(lockFile);
	if (raw === null) return null;
	return parseLease(raw);
}

/** Acquire a named lock lease. Returns a release function, or null if lock is unavailable. */
export function acquireLock(name: string, timeout = 0, options: AcquireLockOptions = {}): (() => void) | null {
	ensureLeaseDirs();

	const lockFile = leasePath(name);
	const leaseName = sanitize(name);
	const hostId = resolveHostId(options.hostId);
	const ownerId = resolveOwnerId(options.ownerId, hostId);
	const heartbeatMs = resolveHeartbeatMs(options.heartbeatMs);
	const ttlMs = resolveTtlMs(options.ttlMs, heartbeatMs);
	const start = Date.now();
	let generationHint = 1;

	while (true) {
		const now = new Date();
		const lease = buildLeaseRecord({
			leaseName,
			ownerId,
			hostId,
			heartbeatMs,
			ttlMs,
			now,
			generation: generationHint,
		});

		if (tryCreateLease(lockFile, lease)) {
			emitLeaseEvent({
				event: "lease_acquired",
				leaseName,
				ownerId,
				generation: lease.generation,
				detail: { heartbeatMs, ttlMs },
			});

			const stopHeartbeat = startLeaseHeartbeat({
				leaseName,
				lockFile,
				ownerId,
				hostId,
				generation: lease.generation,
				heartbeatMs,
			});

			let released = false;
			return () => {
				if (released) return;
				released = true;
				stopHeartbeat();
				releaseLease({ leaseName, lockFile, ownerId, generation: lease.generation });
			};
		}

		const raw = readLeaseRaw(lockFile);
		if (raw !== null) {
			const parsed = parseLeaseStable(lockFile, raw);
			if (!parsed) {
				const reclaimed = reclaimCorruptLease({
					leaseName,
					lockFile,
					now,
					actorOwnerId: ownerId,
				});
				if (reclaimed.reclaimed) continue;
			} else {
				generationHint = Math.max(generationHint, parsed.generation + 1);
				const evaluation = evaluateLease(parsed, now, hostId);
				if (evaluation.state === "stale") {
					const reclaimed = reclaimLease({
						leaseName,
						lockFile,
						observed: parsed,
						reason: evaluation.reason ?? "heartbeat_ttl_exceeded",
						now,
						actorOwnerId: ownerId,
						localHostId: hostId,
					});
					if (reclaimed.reclaimed) {
						generationHint = Math.max(generationHint, (reclaimed.generationHint ?? parsed.generation) + 1);
						continue;
					}
				}
			}
		}

		if (timeout <= 0) return null;
		if (Date.now() - start >= timeout) return null;
		sleep(WAIT_SLICE_MS);
	}
}

/** Check whether a named lease is currently active. Stale/corrupt leases are reclaimed opportunistically. */
export function isLocked(name: string): boolean {
	ensureLeaseDirs();

	const lockFile = leasePath(name);
	const leaseName = sanitize(name);
	const now = new Date();
	const hostId = resolveHostId();
	const raw = readLeaseRaw(lockFile);
	if (raw === null) return false;

	const lease = parseLeaseStable(lockFile, raw);
	if (!lease) {
		reclaimCorruptLease({
			leaseName,
			lockFile,
			now,
			actorOwnerId: `isLocked:${process.pid}`,
		});
		return false;
	}

	const evaluation = evaluateLease(lease, now, hostId);
	if (evaluation.state === "active") return true;

	reclaimLease({
		leaseName,
		lockFile,
		observed: lease,
		reason: evaluation.reason ?? "heartbeat_ttl_exceeded",
		now,
		actorOwnerId: `isLocked:${process.pid}`,
		localHostId: hostId,
	});
	return false;
}

/** Deterministic stale/corrupt lease sweep. */
export function sweepLeases(options: LeaseSweepOptions = {}): LeaseSweepResult {
	ensureLeaseDirs();

	const now = options.now ?? new Date();
	const hostId = resolveHostId(options.hostId);
	const files = readdirSync(lockDirPath()).filter((entry) => entry.endsWith(".lock"));
	const reclaimedLeases: LeaseSweepEntry[] = [];
	let active = 0;

	for (const entry of files) {
		const lockFile = join(lockDirPath(), entry);
		const fallbackLeaseName = entry.slice(0, -".lock".length);
		const raw = readLeaseRaw(lockFile);
		if (raw === null) continue;

		const parsed = parseLeaseStable(lockFile, raw);
		if (!parsed) {
			const reclaimed = reclaimCorruptLease({
				leaseName: fallbackLeaseName,
				lockFile,
				now,
				actorOwnerId: "lease-sweep",
			});
			if (reclaimed.reclaimed && reclaimed.artifactPath) {
				reclaimedLeases.push({
					leaseName: fallbackLeaseName,
					reason: reclaimed.reason,
					previousOwnerId: reclaimed.previousOwnerId,
					artifactPath: reclaimed.artifactPath,
				});
			}
			continue;
		}

		const evaluation = evaluateLease(parsed, now, hostId);
		if (evaluation.state === "active") {
			active += 1;
			continue;
		}

		const reclaimed = reclaimLease({
			leaseName: parsed.leaseName,
			lockFile,
			observed: parsed,
			reason: evaluation.reason ?? "heartbeat_ttl_exceeded",
			now,
			actorOwnerId: "lease-sweep",
			localHostId: hostId,
		});

		if (reclaimed.reclaimed && reclaimed.artifactPath) {
			reclaimedLeases.push({
				leaseName: parsed.leaseName,
				reason: reclaimed.reason,
				previousOwnerId: reclaimed.previousOwnerId,
				artifactPath: reclaimed.artifactPath,
			});
		}
	}

	const resultCore = {
		scanned: files.length,
		active,
		reclaimed: reclaimedLeases.length,
		reclaimedLeases,
	};

	const sweepArtifactPath = join(leaseArtifactsDirPath(), `lease-sweep-${stamp(now)}.json`);
	writeFileSync(
		sweepArtifactPath,
		JSON.stringify(
			{
				schemaVersion: LEASE_SCHEMA_VERSION,
				kind: "lease_sweep",
				capturedAt: now.toISOString(),
				...resultCore,
			},
			null,
			2,
		),
	);

	emitLeaseEvent({
		event: "lease_sweep",
		leaseName: "*",
		detail: {
			scanned: resultCore.scanned,
			active: resultCore.active,
			reclaimed: resultCore.reclaimed,
		},
		artifactPath: sweepArtifactPath,
	});

	return {
		...resultCore,
		sweepArtifactPath,
	};
}

interface BuildLeaseRecordOptions {
	leaseName: string;
	ownerId: string;
	hostId: string;
	heartbeatMs: number;
	ttlMs: number;
	now: Date;
	generation: number;
}

function buildLeaseRecord(options: BuildLeaseRecordOptions): LeaseRecord {
	const nowIso = options.now.toISOString();
	return {
		schemaVersion: LEASE_SCHEMA_VERSION,
		leaseName: options.leaseName,
		status: "active",
		ownerId: options.ownerId,
		hostId: options.hostId,
		pid: process.pid,
		generation: options.generation,
		acquiredAt: nowIso,
		heartbeatAt: nowIso,
		heartbeatIntervalMs: options.heartbeatMs,
		ttlMs: options.ttlMs,
		expiresAt: new Date(options.now.getTime() + options.ttlMs).toISOString(),
		updatedAt: nowIso,
	};
}

interface StartHeartbeatOptions {
	leaseName: string;
	lockFile: string;
	ownerId: string;
	hostId: string;
	generation: number;
	heartbeatMs: number;
}

function startLeaseHeartbeat(options: StartHeartbeatOptions): () => void {
	let stopped = false;

	const timer = setInterval(() => {
		if (stopped) return;
		const now = new Date();
		const raw = readLeaseRaw(options.lockFile);
		if (raw === null) {
			emitLeaseEvent({
				event: "lease_lost",
				leaseName: options.leaseName,
				ownerId: options.ownerId,
				generation: options.generation,
				reason: "non_active_state",
			});
			stopped = true;
			clearInterval(timer);
			return;
		}

		const current = parseLeaseStable(options.lockFile, raw);
		if (!current) {
			reclaimCorruptLease({
				leaseName: options.leaseName,
				lockFile: options.lockFile,
				now,
				actorOwnerId: options.ownerId,
			});
			emitLeaseEvent({
				event: "lease_lost",
				leaseName: options.leaseName,
				ownerId: options.ownerId,
				generation: options.generation,
				reason: "corrupt_record",
			});
			stopped = true;
			clearInterval(timer);
			return;
		}

		if (current.ownerId !== options.ownerId || current.generation !== options.generation) {
			emitLeaseEvent({
				event: "lease_unavailable",
				leaseName: options.leaseName,
				ownerId: options.ownerId,
				previousOwnerId: current.ownerId,
				generation: options.generation,
				reason: "non_active_state",
			});
			stopped = true;
			clearInterval(timer);
			return;
		}

		const evaluation = evaluateLease(current, now, options.hostId);
		if (evaluation.state === "stale") {
			reclaimLease({
				leaseName: options.leaseName,
				lockFile: options.lockFile,
				observed: current,
				reason: evaluation.reason ?? "heartbeat_ttl_exceeded",
				now,
				actorOwnerId: options.ownerId,
				localHostId: options.hostId,
			});
			emitLeaseEvent({
				event: "lease_unavailable",
				leaseName: options.leaseName,
				ownerId: options.ownerId,
				generation: options.generation,
				reason: evaluation.reason ?? "heartbeat_ttl_exceeded",
			});
			stopped = true;
			clearInterval(timer);
			return;
		}

		const refreshed: LeaseRecord = {
			...current,
			status: "active",
			heartbeatAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + current.ttlMs).toISOString(),
			updatedAt: now.toISOString(),
		};

		try {
			writeLeaseAtomically(options.lockFile, refreshed);
		} catch {
			emitLeaseEvent({
				event: "lease_lost",
				leaseName: options.leaseName,
				ownerId: options.ownerId,
				generation: options.generation,
				reason: "non_active_state",
			});
			stopped = true;
			clearInterval(timer);
		}
	}, options.heartbeatMs);

	timer.unref?.();

	return () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
	};
}

interface ReleaseLeaseOptions {
	leaseName: string;
	lockFile: string;
	ownerId: string;
	generation: number;
}

function releaseLease(options: ReleaseLeaseOptions): void {
	const raw = readLeaseRaw(options.lockFile);
	if (raw === null) return;

	const current = parseLeaseStable(options.lockFile, raw);
	if (!current) {
		reclaimCorruptLease({
			leaseName: options.leaseName,
			lockFile: options.lockFile,
			now: new Date(),
			actorOwnerId: options.ownerId,
		});
		return;
	}

	if (current.ownerId !== options.ownerId || current.generation !== options.generation) {
		emitLeaseEvent({
			event: "lease_unavailable",
			leaseName: options.leaseName,
			ownerId: options.ownerId,
			previousOwnerId: current.ownerId,
			generation: options.generation,
			reason: "non_active_state",
		});
		return;
	}

	try {
		unlinkSync(options.lockFile);
		emitLeaseEvent({
			event: "lease_released",
			leaseName: options.leaseName,
			ownerId: options.ownerId,
			generation: options.generation,
		});
	} catch {
		// Already reclaimed or removed.
	}
}

interface ReclaimLeaseOptions {
	leaseName: string;
	lockFile: string;
	observed: LeaseRecord;
	reason: LeaseStaleReason;
	now: Date;
	actorOwnerId: string;
	localHostId: string;
}

function reclaimLease(options: ReclaimLeaseOptions): ReclaimResult {
	const claim = acquireReclaimClaim({
		claimFile: reclaimClaimPath(options.lockFile, options.observed),
		now: options.now,
		localHostId: options.localHostId,
	});
	if (!claim) {
		return { reclaimed: false, reason: options.reason };
	}

	try {
		const raw = readLeaseRaw(options.lockFile);
		if (raw === null) {
			return { reclaimed: false, reason: options.reason };
		}

		const current = parseLeaseStable(options.lockFile, raw);
		if (!current) {
			return reclaimCorruptLease({
				leaseName: options.leaseName,
				lockFile: options.lockFile,
				now: options.now,
				actorOwnerId: options.actorOwnerId,
			});
		}

		if (!sameLeaseIdentity(current, options.observed)) {
			return { reclaimed: false, reason: options.reason };
		}

		const evaluation = evaluateLease(current, options.now, options.localHostId);
		if (evaluation.state !== "stale") {
			return { reclaimed: false, reason: evaluation.reason ?? options.reason };
		}

		const reason = evaluation.reason ?? options.reason;
		const staleLease: LeaseRecord = {
			...current,
			status: "stale",
			staleReason: reason,
			updatedAt: options.now.toISOString(),
		};

		const artifactPath = writeReclaimArtifact({
			leaseName: options.leaseName,
			kind: "lease_reclaim",
			now: options.now,
			reason,
			actorOwnerId: options.actorOwnerId,
			previousLease: staleLease,
		});

		try {
			unlinkSync(options.lockFile);
		} catch {
			return {
				reclaimed: false,
				reason,
				previousOwnerId: current.ownerId,
				artifactPath,
				generationHint: current.generation,
			};
		}

		emitLeaseEvent({
			event: "lease_stale",
			leaseName: options.leaseName,
			ownerId: current.ownerId,
			generation: current.generation,
			reason,
			artifactPath,
		});
		emitLeaseEvent({
			event: "lease_reclaimed",
			leaseName: options.leaseName,
			ownerId: options.actorOwnerId,
			previousOwnerId: current.ownerId,
			generation: current.generation,
			reason,
			artifactPath,
		});

		return {
			reclaimed: true,
			reason,
			previousOwnerId: current.ownerId,
			artifactPath,
			generationHint: current.generation,
		};
	} finally {
		claim.release();
	}
}

function reclaimClaimPath(lockFile: string, observed: LeaseRecord): string {
	return `${lockFile}.${sanitize(observed.ownerId)}.${observed.generation}.reclaim`;
}

interface AcquireReclaimClaimOptions {
	claimFile: string;
	now: Date;
	localHostId: string;
}

function acquireReclaimClaim(options: AcquireReclaimClaimOptions): ReclaimClaim | null {
	for (let attempt = 0; attempt < 2; attempt++) {
		let fd: number | null = null;
		try {
			fd = openSync(options.claimFile, "wx");
			writeFileSync(
				fd,
				JSON.stringify({
					pid: process.pid,
					hostId: options.localHostId,
					createdAt: options.now.toISOString(),
				}),
			);
			return {
				release: () => {
					try {
						unlinkSync(options.claimFile);
					} catch {
						// Best effort.
					}
				},
			};
		} catch (err) {
			if (!isNodeErrorCode(err, "EEXIST")) throw err;
			const reclaimed = reclaimStaleClaimFile(options);
			if (!reclaimed) return null;
		} finally {
			if (fd !== null) closeSync(fd);
		}
	}

	return null;
}

function reclaimStaleClaimFile(options: AcquireReclaimClaimOptions): boolean {
	if (!existsSync(options.claimFile)) return true;
	try {
		const raw = readFileSync(options.claimFile, "utf-8");
		const parsed = JSON.parse(raw) as { pid?: number; hostId?: string; createdAt?: string };
		const claimHost = typeof parsed.hostId === "string" ? parsed.hostId : "";
		const claimPid = typeof parsed.pid === "number" ? parsed.pid : null;
		const createdAtMs = Date.parse(String(parsed.createdAt || ""));
		const expired = Number.isNaN(createdAtMs) || options.now.getTime() - createdAtMs >= RECLAIM_CLAIM_TTL_MS;
		const deadLocalPid = claimHost === options.localHostId && claimPid !== null && !isPidAlive(claimPid);
		if (!expired && !deadLocalPid) return false;
	} catch {
		// Invalid claim file => reclaim.
	}

	try {
		unlinkSync(options.claimFile);
		return true;
	} catch {
		return !existsSync(options.claimFile);
	}
}

interface ReclaimCorruptLeaseOptions {
	leaseName: string;
	lockFile: string;
	now: Date;
	actorOwnerId: string;
}

function reclaimCorruptLease(options: ReclaimCorruptLeaseOptions): ReclaimResult {
	const raw = readLeaseRaw(options.lockFile);
	if (raw === null) {
		return { reclaimed: false, reason: "corrupt_record" };
	}

	const artifactPath = writeReclaimArtifact({
		leaseName: options.leaseName,
		kind: "lease_corrupt_reclaim",
		now: options.now,
		reason: "corrupt_record",
		actorOwnerId: options.actorOwnerId,
		rawLease: raw,
	});

	try {
		unlinkSync(options.lockFile);
	} catch {
		return {
			reclaimed: false,
			reason: "corrupt_record",
			artifactPath,
		};
	}

	emitLeaseEvent({
		event: "lease_stale",
		leaseName: options.leaseName,
		ownerId: options.actorOwnerId,
		reason: "corrupt_record",
		artifactPath,
	});
	emitLeaseEvent({
		event: "lease_reclaimed",
		leaseName: options.leaseName,
		ownerId: options.actorOwnerId,
		reason: "corrupt_record",
		artifactPath,
	});

	return {
		reclaimed: true,
		reason: "corrupt_record",
		artifactPath,
	};
}

interface ReclaimArtifactOptions {
	leaseName: string;
	kind: "lease_reclaim" | "lease_corrupt_reclaim";
	now: Date;
	reason: LeaseStaleReason;
	actorOwnerId: string;
	previousLease?: LeaseRecord;
	rawLease?: string;
}

function writeReclaimArtifact(options: ReclaimArtifactOptions): string {
	ensureLeaseDirs();
	const filePath = join(
		leaseArtifactsDirPath(),
		`${sanitize(options.leaseName)}.${options.kind}.${stamp(options.now)}.${randomBytes(3).toString("hex")}.json`,
	);
	writeFileSync(
		filePath,
		JSON.stringify(
			{
				schemaVersion: LEASE_SCHEMA_VERSION,
				kind: options.kind,
				capturedAt: options.now.toISOString(),
				leaseName: options.leaseName,
				reason: options.reason,
				reclaimedBy: options.actorOwnerId,
				previousLease: options.previousLease,
				rawLease: options.rawLease,
			},
			null,
			2,
		),
	);
	return filePath;
}

function evaluateLease(lease: LeaseRecord, now: Date, localHostId: string): LeaseEvaluation {
	if (lease.status !== "active") {
		return { state: "stale", reason: "non_active_state" };
	}

	if (lease.hostId === localHostId && typeof lease.pid === "number" && !isPidAlive(lease.pid)) {
		return { state: "stale", reason: "pid_dead" };
	}

	const heartbeatAtMs = Date.parse(lease.heartbeatAt);
	const expiresAtMs = Date.parse(lease.expiresAt);
	if (Number.isNaN(heartbeatAtMs) || Number.isNaN(expiresAtMs)) {
		return { state: "stale", reason: "corrupt_record" };
	}

	if (now.getTime() >= expiresAtMs) {
		return { state: "stale", reason: "heartbeat_ttl_exceeded" };
	}

	if (now.getTime() - heartbeatAtMs >= lease.ttlMs) {
		return { state: "stale", reason: "heartbeat_ttl_exceeded" };
	}

	return { state: "active" };
}

function sameLeaseIdentity(a: LeaseRecord, b: LeaseRecord): boolean {
	return a.ownerId === b.ownerId && a.generation === b.generation && a.leaseName === b.leaseName;
}

function writeLeaseAtomically(lockFile: string, lease: LeaseRecord): void {
	const tmpPath = `${lockFile}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(lease, null, 2));
	renameSync(tmpPath, lockFile);
}

function tryCreateLease(lockFile: string, lease: LeaseRecord): boolean {
	let fd: number | null = null;
	try {
		fd = openSync(lockFile, "wx");
		writeFileSync(fd, JSON.stringify(lease, null, 2));
		return true;
	} catch (err) {
		if (isNodeErrorCode(err, "EEXIST")) return false;
		throw err;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

function readLeaseRaw(lockFile: string): string | null {
	if (!existsSync(lockFile)) return null;
	try {
		return readFileSync(lockFile, "utf-8");
	} catch {
		return null;
	}
}

function parseLeaseStable(lockFile: string, raw: string): LeaseRecord | null {
	let candidateRaw: string | null = raw;
	for (let attempt = 0; attempt < PARSE_RETRY_ATTEMPTS; attempt++) {
		if (candidateRaw === null) return null;
		const parsed = parseLease(candidateRaw);
		if (parsed) return parsed;
		if (attempt >= PARSE_RETRY_ATTEMPTS - 1) break;
		sleep(PARSE_RETRY_DELAY_MS);
		candidateRaw = readLeaseRaw(lockFile);
	}
	return null;
}

function parseLease(raw: string): LeaseRecord | null {
	try {
		const parsed = JSON.parse(raw);
		return isLeaseRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isLeaseRecord(value: unknown): value is LeaseRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== LEASE_SCHEMA_VERSION) return false;
	if (typeof record.leaseName !== "string") return false;
	if (typeof record.ownerId !== "string") return false;
	if (typeof record.hostId !== "string") return false;
	if (!isLeaseStatus(record.status)) return false;
	if (record.pid !== null && typeof record.pid !== "number") return false;
	if (typeof record.generation !== "number") return false;
	if (typeof record.acquiredAt !== "string") return false;
	if (typeof record.heartbeatAt !== "string") return false;
	if (typeof record.heartbeatIntervalMs !== "number") return false;
	if (typeof record.ttlMs !== "number") return false;
	if (typeof record.expiresAt !== "string") return false;
	if (typeof record.updatedAt !== "string") return false;
	if (record.staleReason !== undefined && !isLeaseStaleReason(record.staleReason)) return false;
	return true;
}

function isLeaseStatus(value: unknown): value is LeaseStatus {
	return value === "active" || value === "stale" || value === "released" || value === "unavailable";
}

function isLeaseStaleReason(value: unknown): value is LeaseStaleReason {
	return (
		value === "heartbeat_ttl_exceeded" ||
		value === "pid_dead" ||
		value === "non_active_state" ||
		value === "corrupt_record"
	);
}

function resolveHeartbeatMs(value?: number): number {
	const env = Number(process.env["HATCH_LEASE_HEARTBEAT_MS"] || "");
	const candidate = Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : env;
	if (!Number.isFinite(candidate) || candidate <= 0) return DEFAULT_HEARTBEAT_MS;
	return Math.max(10, Math.floor(candidate));
}

function resolveTtlMs(value: number | undefined, heartbeatMs: number): number {
	const env = Number(process.env["HATCH_LEASE_TTL_MS"] || "");
	const candidate = Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : env;
	const fallback = Number.isFinite(candidate) && candidate > 0 ? candidate : DEFAULT_TTL_MS;
	const minTtl = Math.max(heartbeatMs * 2, heartbeatMs + 10);
	return Math.max(Math.floor(fallback), minTtl);
}

function resolveHostId(explicit?: string): string {
	const fromArg = String(explicit || "").trim();
	if (fromArg) return fromArg;
	const fromEnv = String(process.env["HATCH_LEASE_HOST_ID"] || "").trim();
	if (fromEnv) return fromEnv;
	return hostname();
}

function resolveOwnerId(explicit: string | undefined, hostId: string): string {
	const fromArg = String(explicit || "").trim();
	if (fromArg) return fromArg;
	return `${hostId}:${process.pid}:${randomBytes(4).toString("hex")}`;
}

function ensureLeaseDirs(): void {
	if (!existsSync(lockDirPath())) mkdirSync(lockDirPath(), { recursive: true });
	if (!existsSync(leaseArtifactsDirPath())) mkdirSync(leaseArtifactsDirPath(), { recursive: true });
}

function sanitize(name: string): string {
	return String(name || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function stamp(now: Date): string {
	return now.toISOString().replace(/[:.]/g, "-");
}

function sleep(ms: number): void {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		/* busy wait (sync lock API) */
	}
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function emitLeaseEvent(event: Omit<LeaseEventRecord, "schemaVersion" | "ts">): void {
	ensureLeaseDirs();
	const payload: LeaseEventRecord = {
		schemaVersion: LEASE_SCHEMA_VERSION,
		ts: new Date().toISOString(),
		...event,
	};
	writeFileSync(leaseEventsPath(), `${JSON.stringify(payload)}\n`, { flag: "a" });
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code;
}
