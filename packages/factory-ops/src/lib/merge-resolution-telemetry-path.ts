import { join } from "node:path";

import { trim } from "./cli-helpers.ts";
import { resolveRunsDir } from "./runs-dir-resolver.ts";

// @context:regression The failure emitter and recurrence reader share one event path.
function resolveMergeTelemetryFactoryId(factoryId = "") {
  const explicit = trim(factoryId);
  if (explicit) return explicit;
  return trim(process.env.FACTORY_ID || process.env.HATCH_FACTORY_ID || "") || "mothership";
}
export function resolveMergeTelemetryFilePath({ factoryId = "", runsDir = "" } = {}) {
  const resolvedFactoryId = resolveMergeTelemetryFactoryId(factoryId);
  const explicitRunsDir = trim(runsDir) || trim(process.env.HATCH_RUNS_DIR || "");
  const resolvedRunsDir = explicitRunsDir || resolveRunsDir({ factoryId: resolvedFactoryId });
  const eventsDir = join(resolvedRunsDir, "..", "events");
  const filePath = join(eventsDir, "merge_conflict_resolution_failures.ndjson");
  return {
    factoryId: resolvedFactoryId,
    eventsDir,
    filePath,
  };
}
