export type ForemanMode = "watch" | "investigate" | "propose" | "repair";

export type ForemanIncidentStatus = "open" | "resolved";

export interface ForemanProbeFinding {
  probe: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface ForemanProbeSnapshot {
  factory_id: string;
  timestamp: string;
  anomaly_detected: boolean;
  anomalies: ForemanProbeFinding[];
  nominal_probes: string[];
  summary?: string;
}

export interface ForemanIncidentRecord {
  incident_id: string;
  factory_id: string;
  status: ForemanIncidentStatus;
  opened_at: string;
  updated_at: string;
  mode: ForemanMode;
  summary: string;
  anomaly_fingerprint: string;
  owning_cycle_id: string;
}

export interface ForemanInvestigation {
  root_cause: string;
  action: string;
  outcome: string;
}

export interface ForemanCycleArtifact {
  type: "foreman_cycle";
  cycle_id: string;
  factory_id: string;
  timestamp: string;
  mode: ForemanMode;
  anomaly_detected: boolean;
  anomalies: ForemanProbeFinding[];
  incident_id: string | null;
  summary: string;
  investigation: ForemanInvestigation | null;
  duration_ms: number;
  cost: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    usd?: number;
  };
}

export interface ForemanCycleInput {
  cycle_id: string;
  mode: ForemanMode;
  probe: ForemanProbeSnapshot;
  active_incident: ForemanIncidentRecord | null;
}

export interface ForemanCycleDecision {
  mode: ForemanMode;
  summary: string;
  open_incident?: {
    summary: string;
    anomaly_fingerprint?: string;
  };
  resolve_incident?: boolean;
  investigation?: ForemanInvestigation | null;
  cost?: ForemanCycleArtifact["cost"];
}

export interface ForemanSessionRunner {
  run(input: ForemanCycleInput): Promise<ForemanCycleDecision>;
}

export interface ForemanStatusSnapshot {
  factory_id: string;
  mode: ForemanMode;
  active_incident_id: string | null;
  pending_probe: boolean;
  summary: string;
}
