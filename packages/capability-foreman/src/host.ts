import { createHash } from "node:crypto";

import { writeForemanArtifact } from "./telemetry.js";

import type {
  ForemanCycleArtifact,
  ForemanCycleDecision,
  ForemanCycleInput,
  ForemanIncidentRecord,
  ForemanProbeSnapshot,
  ForemanSessionRunner,
  ForemanStatusSnapshot,
} from "./types.js";

export interface ForemanHostOptions {
  factoryId: string;
  runsDir: string;
  sessionRunner: ForemanSessionRunner;
  now?: () => number;
  writeArtifact?: typeof writeForemanArtifact;
  persistIncident?: (incident: ForemanIncidentRecord | null) => Promise<void> | void;
}

function cycleId(snapshot: ForemanProbeSnapshot) {
  const hash = createHash("sha256");
  hash.update(snapshot.factory_id);
  hash.update(snapshot.timestamp);
  hash.update(JSON.stringify(snapshot.anomalies));
  return hash.digest("hex").slice(0, 8);
}

function anomalyFingerprint(snapshot: ForemanProbeSnapshot) {
  const hash = createHash("sha256");
  hash.update(snapshot.factory_id);
  hash.update(JSON.stringify(snapshot.anomalies.map(({ probe, status, detail }) => ({ probe, status, detail }))));
  return hash.digest("hex");
}

export class ForemanHost {
  #factoryId: string;
  #runsDir: string;
  #sessionRunner: ForemanSessionRunner;
  #writeArtifact: typeof writeForemanArtifact;
  #persistIncident: ForemanHostOptions["persistIncident"];
  #now: () => number;
  #activeIncident: ForemanIncidentRecord | null = null;
  #pendingProbe: ForemanProbeSnapshot | null = null;
  #inFlight: Promise<ForemanCycleArtifact> | null = null;
  #lastSummary = "booting";
  #lastMode: ForemanCycleInput["mode"] = "watch";

  constructor(options: ForemanHostOptions) {
    this.#factoryId = options.factoryId;
    this.#runsDir = options.runsDir;
    this.#sessionRunner = options.sessionRunner;
    this.#writeArtifact = options.writeArtifact ?? writeForemanArtifact;
    this.#persistIncident = options.persistIncident;
    this.#now = options.now ?? Date.now;
  }

  getStatus(): ForemanStatusSnapshot {
    return {
      factory_id: this.#factoryId,
      mode: this.#lastMode,
      active_incident_id: this.#activeIncident?.incident_id ?? null,
      pending_probe: this.#pendingProbe !== null,
      summary: this.#lastSummary,
    };
  }

  async enqueueProbe(snapshot: ForemanProbeSnapshot) {
    if (this.#inFlight) {
      this.#pendingProbe = snapshot;
      return this.#inFlight;
    }
    return this.#runLoop(snapshot);
  }

  async #runLoop(initial: ForemanProbeSnapshot) {
    let next: ForemanProbeSnapshot | null = initial;
    let lastArtifact: ForemanCycleArtifact | null = null;
    while (next) {
      const current = next;
      this.#pendingProbe = null;
      this.#inFlight = this.#runOnce(current);
      lastArtifact = await this.#inFlight;
      this.#inFlight = null;
      next = this.#pendingProbe;
    }
    return lastArtifact as ForemanCycleArtifact;
  }

  async #runOnce(snapshot: ForemanProbeSnapshot) {
    const startedAt = this.#now();
    const cycleInput: ForemanCycleInput = {
      cycle_id: cycleId(snapshot),
      mode: this.#activeIncident ? this.#activeIncident.mode : "watch",
      probe: snapshot,
      active_incident: this.#activeIncident,
    };
    const decision = await this.#sessionRunner.run(cycleInput);
    const incidentId = await this.#applyDecision(cycleInput, decision);
    this.#lastMode = decision.mode;
    this.#lastSummary = decision.summary;
    const artifact: ForemanCycleArtifact = {
      type: "foreman_cycle",
      cycle_id: cycleInput.cycle_id,
      factory_id: this.#factoryId,
      timestamp: snapshot.timestamp,
      mode: decision.mode,
      anomaly_detected: snapshot.anomaly_detected,
      anomalies: snapshot.anomalies,
      incident_id: incidentId,
      summary: decision.summary,
      investigation: decision.investigation ?? null,
      duration_ms: Math.max(0, this.#now() - startedAt),
      cost: decision.cost ?? {},
    };
    await this.#writeArtifact(this.#runsDir, artifact);
    return artifact;
  }

  async #applyDecision(input: ForemanCycleInput, decision: ForemanCycleDecision) {
    if (decision.resolve_incident && this.#activeIncident) {
      this.#activeIncident = {
        ...this.#activeIncident,
        status: "resolved",
        updated_at: input.probe.timestamp,
      };
      await this.#persistIncident?.(this.#activeIncident);
      this.#activeIncident = null;
      return null;
    }

    if (decision.open_incident || input.probe.anomaly_detected) {
      const fingerprint = decision.open_incident?.anomaly_fingerprint ?? anomalyFingerprint(input.probe);
      if (this.#activeIncident && this.#activeIncident.anomaly_fingerprint === fingerprint) {
        this.#activeIncident = {
          ...this.#activeIncident,
          updated_at: input.probe.timestamp,
          mode: decision.mode,
          summary: decision.open_incident?.summary ?? decision.summary,
          owning_cycle_id: input.cycle_id,
        };
      } else {
        this.#activeIncident = {
          incident_id: `incident-${input.cycle_id}`,
          factory_id: this.#factoryId,
          status: "open",
          opened_at: input.probe.timestamp,
          updated_at: input.probe.timestamp,
          mode: decision.mode,
          summary: decision.open_incident?.summary ?? decision.summary,
          anomaly_fingerprint: fingerprint,
          owning_cycle_id: input.cycle_id,
        };
      }
      await this.#persistIncident?.(this.#activeIncident);
      return this.#activeIncident.incident_id;
    }

    return this.#activeIncident?.incident_id ?? null;
  }
}
