import { saveRunState } from "./run.js";

import type { Context, StageRecord } from "./context.js";
import type { RunState } from "./run.js";

export interface LifecycleStateEngineView {
	getRunState(): RunState | undefined;
	getContext(): Context;
	getRecords(): StageRecord[];
}

/**
 * Persist run-state context/records after lifecycle telemetry updates.
 *
 * This is used by graceful shutdown and run-finalization paths so
 * lifecycle retry metadata (for example __langfuse_retry_*) survives restart/recover.
 */
export function persistLifecycleContextFromEngine(engine: LifecycleStateEngineView | null | undefined): void {
	if (!engine) return;
	const runState = engine.getRunState();
	if (!runState) return;
	runState.context = engine.getContext().all();
	runState.records = engine.getRecords();
	saveRunState(runState, { updateMetadata: true });
}
