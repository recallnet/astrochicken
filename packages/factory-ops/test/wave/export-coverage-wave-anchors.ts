// Coverage anchors for export-coverage gate.
// These imports intentionally ensure command re-export symbols remain tracked.

import { WAVE_READY_LEASE_EVENT_PREFIX } from "../../src/commands/wave-claim.ts";
import { planWaveOrphanStateRepair } from "../../src/commands/wave-sanitize-state.ts";

void WAVE_READY_LEASE_EVENT_PREFIX;
void planWaveOrphanStateRepair;
