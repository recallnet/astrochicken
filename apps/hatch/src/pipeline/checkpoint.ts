import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertPathDoesNotRecreateConfiguredRepo } from "../factory/repo-path-health.js";

import type { StageRecord } from "./context.js";

/** Checkpoint captures pipeline state for resume. */
export interface Checkpoint {
	/** Pipeline file path. */
	pipelineFile: string;
	/** Current node ID. */
	currentNodeId: string;
	/** Last output from previous node. */
	lastOutput: string;
	/** Context key-value pairs. */
	context: Record<string, string>;
	/** Completed stage records. */
	records: StageRecord[];
	/** Timestamp of checkpoint. */
	savedAt: string;
}

/** Save a checkpoint to disk. */
export function saveCheckpoint(checkpointPath: string, checkpoint: Checkpoint): void {
	assertPathDoesNotRecreateConfiguredRepo(checkpointPath, { label: "checkpoint_path" });
	const dir = dirname(checkpointPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	// Serialize with date conversion
	const serializable = {
		...checkpoint,
		records: checkpoint.records.map((r) => ({
			...r,
			startedAt: r.startedAt.toISOString(),
			endedAt: r.endedAt?.toISOString(),
		})),
	};

	writeFileSync(checkpointPath, JSON.stringify(serializable, null, 2));
}

/** Load a checkpoint from disk. */
export function loadCheckpoint(checkpointPath: string): Checkpoint {
	const raw = readFileSync(checkpointPath, "utf-8");
	const data = JSON.parse(raw);

	// Deserialize dates
	return {
		...data,
		records: (data.records || []).map((r: any) => ({
			...r,
			startedAt: new Date(r.startedAt),
			endedAt: r.endedAt ? new Date(r.endedAt) : undefined,
		})),
	};
}

/** Default checkpoint path for a pipeline file. */
export function defaultCheckpointPath(pipelineFile: string): string {
	return join(dirname(pipelineFile), `.hatch-checkpoint-${basename(pipelineFile)}.json`);
}

function basename(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1].replace(/\.dot$/, "");
}
