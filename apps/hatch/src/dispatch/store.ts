import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const DISPATCH_STORE_DIR = join(".hatch", "dispatch");
export const DISPATCH_QUEUE_FILE = "queue.json";
const DISPATCH_TICKS_DIR = "ticks";
const DISPATCH_RUNS_DIR = "runs";
const DISPATCH_QUEUE_SNAPSHOTS_DIR = "queue-snapshots";

export interface DispatchQueueEntry {
	graph: string;
	goal_id?: string;
	context?: Record<string, unknown>;
	context_path?: string;
}

export interface DispatchTickSelection {
	graph: string;
	goal_id?: string;
	run_id: string;
	command: string;
	context_path?: string;
	context?: Record<string, unknown>;
}

export interface DispatchTickRecord {
	tick_id: string;
	status: "running" | "completed" | "failed";
	started_at: string;
	completed_at?: string;
	queue_source: string;
	queue_snapshot: string;
	max_per_tick: number;
	selected: DispatchTickSelection[];
	run_ids: string[];
	errors?: string[];
}

export interface DispatchRunRecord {
	run_id: string;
	tick_id: string;
	graph: string;
	goal_id?: string;
	status: "queued" | "running" | "failed";
	command: string;
	created_at: string;
	updated_at?: string;
	pid?: number;
	context_path?: string;
	context?: Record<string, unknown>;
}

export interface DispatchStorePaths {
	storeDir: string;
	ticksDir: string;
	runsDir: string;
	queueSnapshotsDir: string;
}

export function dispatchStorePaths(rootDir: string): DispatchStorePaths {
	const storeDir = join(rootDir, DISPATCH_STORE_DIR);
	return {
		storeDir,
		ticksDir: join(storeDir, DISPATCH_TICKS_DIR),
		runsDir: join(storeDir, DISPATCH_RUNS_DIR),
		queueSnapshotsDir: join(storeDir, DISPATCH_QUEUE_SNAPSHOTS_DIR),
	};
}

export function ensureDispatchStore(rootDir: string): DispatchStorePaths {
	const paths = dispatchStorePaths(rootDir);
	for (const dir of [paths.storeDir, paths.ticksDir, paths.runsDir, paths.queueSnapshotsDir]) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
	return paths;
}

export function dispatchQueueSourcePath(rootDir: string, queuePath?: string): string {
	const resolved = queuePath ? resolve(rootDir, queuePath) : resolve(rootDir, DISPATCH_STORE_DIR, DISPATCH_QUEUE_FILE);
	const dir = dirname(resolved);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return resolved;
}

export function dispatchQueueSnapshotPath(rootDir: string, tickId: string): string {
	const { queueSnapshotsDir } = ensureDispatchStore(rootDir);
	return join(queueSnapshotsDir, `${tickId}.json`);
}

export function dispatchTickRecordPath(rootDir: string, tickId: string): string {
	const { ticksDir } = ensureDispatchStore(rootDir);
	return join(ticksDir, `${tickId}.json`);
}

export function dispatchRunRecordPath(rootDir: string, runId: string): string {
	const { runsDir } = ensureDispatchStore(rootDir);
	return join(runsDir, `${runId}.json`);
}

export function loadDispatchQueue(queuePath: string): DispatchQueueEntry[] {
	if (!existsSync(queuePath)) return [];
	const raw = readFileSync(queuePath, "utf8").trim();
	if (!raw) return [];
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) {
		throw new Error(`Dispatch queue must be an array: ${queuePath}`);
	}
	return parsed as DispatchQueueEntry[];
}

export function saveDispatchQueue(queuePath: string, entries: DispatchQueueEntry[]): void {
	writeJsonAtomic(queuePath, entries);
}

export function saveDispatchTickRecord(rootDir: string, record: DispatchTickRecord): void {
	const path = dispatchTickRecordPath(rootDir, record.tick_id);
	writeJsonAtomic(path, record);
}

export function saveDispatchRunRecord(rootDir: string, record: DispatchRunRecord): void {
	const path = dispatchRunRecordPath(rootDir, record.run_id);
	writeJsonAtomic(path, record);
}

export function nextDispatchTickId(rootDir: string): string {
	const { ticksDir } = ensureDispatchStore(rootDir);
	if (!existsSync(ticksDir)) return "tick-000001";

	let max = 0;
	for (const entry of readdirSync(ticksDir)) {
		if (!entry.startsWith("tick-") || !entry.endsWith(".json")) continue;
		const numeric = entry.slice("tick-".length, -".json".length);
		const value = Number.parseInt(numeric, 10);
		if (Number.isFinite(value)) max = Math.max(max, value);
	}

	const next = max + 1;
	return `tick-${String(next).padStart(6, "0")}`;
}

export function dispatchRelativePath(rootDir: string, path: string): string {
	const rel = relative(rootDir, path);
	return rel || ".";
}

function writeJsonAtomic(path: string, data: unknown): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(data, null, 2));
	renameSync(tmpPath, path);
}
