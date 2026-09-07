import { factoryTickStatus as readCanonicalFactoryTickStatus } from "../lib/factory-tick-canonical.ts";
import {
  STAGE_LABELS,
  STAGE_ORDER,
  formatTickStatus,
} from "../lib/factory-tick-run-projection.ts";
import {
  PROJECTION_DIMENSIONS,
  ensureProjectionDimensions,
} from "../lib/insight-contract.ts";

export { STAGE_LABELS, STAGE_ORDER, formatTickStatus };
export const FACTORY_TICK_STATUS_PROJECTION_DIMENSIONS = PROJECTION_DIMENSIONS.factory_tick_status;

export function tickStatus({ runsDir = ".hatch/runs", context = {}, now = Date.now() } = {}) {
  return ensureProjectionDimensions("factory_tick_status", readCanonicalFactoryTickStatus({ runsDir, context, now }));
}
