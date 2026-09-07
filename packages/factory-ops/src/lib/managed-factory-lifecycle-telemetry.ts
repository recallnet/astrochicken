import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";

import { readCurrentLease } from "./daemon-lease.ts";
import { createIncidentFingerprint } from "./incident-fingerprint.ts";

const REQUIRED_IDENTITY_FIELDS = Object.freeze([
  "factory_id",
  "instance_id",
  "installation_id",
  "host_id",
  "kind_id",
  "runtime_version",
  "kind_version",
  "policy_profile",
]);

function trim(value = "") {
  return String(value || "").trim();
}

export function normalizeFiniteDurationMs(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function readKindVersionFromManifest(kindManifestPath = "") {
  const normalizedPath = trim(kindManifestPath);
  if (!normalizedPath || !existsSync(normalizedPath)) return "";
  try {
    const parsed = JSON.parse(readFileSync(normalizedPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const explicitVersion = trim(parsed.kind_version || parsed.version || "");
    if (explicitVersion) return explicitVersion;
    const schemaVersion = trim(parsed.schema_version ?? "");
    if (schemaVersion) return schemaVersion;
    return "";
  } catch {
    return "";
  }
}

function resolveManagedKindVersion({ runtime = {}, repoRoot = "" } = {}) {
  const explicit = trim(runtime?.config?.kind_version || runtime?.config?.kindVersion || runtime?.kindVersion || "");
  if (explicit) return explicit;

  const factoryRoot = trim(runtime?.factoryRoot || runtime?.config?.factory_root || "");
  if (factoryRoot) {
    const fromFactoryRoot = readKindVersionFromManifest(path.resolve(factoryRoot, "kind.json"));
    if (fromFactoryRoot) return fromFactoryRoot;
  }

  const kindId = trim(runtime?.mutationContext?.kind_id || runtime?.config?.kind_id || runtime?.factoryId || "");
  if (kindId) {
    const base = trim(repoRoot) || process.cwd();
    const fromKindPath = readKindVersionFromManifest(path.resolve(base, "factories", kindId, "kind.json"));
    if (fromKindPath) return fromKindPath;
  }

  return "";
}

function resolveManagedPolicyProfile(runtime = {}) {
  const explicit = trim(runtime?.config?.policy_profile || runtime?.config?.policyProfile || runtime?.policyProfile || "");
  if (explicit) return explicit;
  const policyPackVersion = trim(runtime?.config?.policyPack?.version || runtime?.config?.policy_pack?.version || "");
  if (policyPackVersion) return `policy_pack:${policyPackVersion}`;
  const provider = trim(runtime?.config?.provider || runtime?.provider || "");
  const model = trim(runtime?.config?.model || runtime?.model || "");
  if (provider && model) {
    // @context:regression !critical Managed factories can use inline model config with no policy pack;
    // lifecycle telemetry must derive a stable profile here or the daemon fail-closes every tick.
    return `inline-config:${provider}:${model}`;
  }
  return trim(process.env.HATCH_POLICY_PROFILE || "");
}

function resolveManagedTelemetryIdentity({
  runtime = {},
  paths = {},
  repoRoot = "",
  readCurrentLeaseFn = readCurrentLease,
} = {}) {
  let lease = {};
  try {
    const leaseSnapshot = readCurrentLeaseFn({ paths });
    lease = leaseSnapshot && typeof leaseSnapshot === "object" && leaseSnapshot.lease && typeof leaseSnapshot.lease === "object"
      ? leaseSnapshot.lease
      : {};
  } catch {
    lease = {};
  }

  return {
    factory_id: trim(runtime.factoryId || runtime.config?.factory_id || ""),
    instance_id: trim(runtime.mutationContext?.instance_id || runtime.config?.instance_id || lease.instance_id || runtime.factoryId || ""),
    installation_id: trim(lease.installation_id || process.env.HATCH_INSTALLATION_ID || ""),
    host_id: trim(lease.host_id || process.env.HATCH_HOST_ID || process.env.HOST_ID || ""),
    kind_id: trim(runtime.mutationContext?.kind_id || runtime.config?.kind_id || runtime.factoryId || ""),
    runtime_version: trim(lease.runtime_version || runtime.config?.runtime_version || process.env.HATCH_RUNTIME_VERSION || ""),
    kind_version: resolveManagedKindVersion({ runtime, repoRoot }),
    policy_profile: resolveManagedPolicyProfile(runtime),
  };
}

function normalizeLifecycleTiming({ startedAt = "", endedAt = "", durationMs = 0 } = {}) {
  const normalizedDurationMs = normalizeFiniteDurationMs(durationMs);
  const normalizedStartedAt = trim(startedAt) || new Date().toISOString();
  const startedMs = Date.parse(normalizedStartedAt);

  const normalizedEndedAt = trim(endedAt)
    || (Number.isFinite(startedMs)
      ? new Date(startedMs + normalizedDurationMs).toISOString()
      : new Date().toISOString());

  const endedMs = Date.parse(normalizedEndedAt);
  if (Number.isFinite(startedMs) && Number.isFinite(endedMs)) {
    return {
      started_at: normalizedStartedAt,
      ended_at: normalizedEndedAt,
      duration_ms: Math.max(0, Math.trunc(endedMs - startedMs)),
    };
  }

  return {
    started_at: normalizedStartedAt,
    ended_at: normalizedEndedAt,
    duration_ms: normalizedDurationMs,
  };
}

function resolveManagedLifecycleEventName(eventType = "") {
  switch (trim(eventType)) {
    case "factory.lifecycle.tick":
      return "factory.lifecycle.tick";
    case "factory.lifecycle.sleep":
      return "factory.lifecycle.sleep";
    default:
      return "";
  }
}

export function emitManagedLifecycleEventImpl({
  runtime = {},
  paths = {},
  repoRoot = "",
  daemonLogPath = "",
  eventType = "",
  status = "",
  runId = "",
  tickId = "",
  startedAt = "",
  endedAt = "",
  durationMs = 0,
  incidentFingerprint = "",
  incidentSeed = {},
  readCurrentLeaseFn = readCurrentLease,
  emitOtelEventFn = emitGovernedOtelEvent,
  appendLogLineFn = () => {},
  requiredEventDefinitions = [],
  extraFields = {},
} = {}) {
  const normalizedEventType = trim(eventType);
  const normalizedStatus = trim(status);
  if (!normalizedEventType || !normalizedStatus) {
    appendLogLineFn(daemonLogPath, `telemetry_emit_skipped event=${normalizedEventType || "unknown"} reason=missing_event_or_status`);
    return { ok: false, reason: "missing_event_or_status" };
  }

  const identity = resolveManagedTelemetryIdentity({
    runtime,
    paths,
    repoRoot,
    readCurrentLeaseFn,
  });

  const missingIdentityFields = REQUIRED_IDENTITY_FIELDS
    .filter((field) => !trim(identity[field]));
  if (missingIdentityFields.length > 0) {
    appendLogLineFn(
      daemonLogPath,
      `telemetry_emit_skipped event=${normalizedEventType} reason=missing_required_identity fields=${missingIdentityFields.join(",")}`,
    );
    return {
      ok: false,
      reason: "missing_required_identity",
      missing_fields: missingIdentityFields,
    };
  }

  const normalizedTickId = trim(tickId) || `daemon-loop-${Date.now()}`;
  const normalizedRunId = trim(runId) || normalizedTickId;
  const governedEventName = resolveManagedLifecycleEventName(normalizedEventType);
  if (!governedEventName) {
    appendLogLineFn(
      daemonLogPath,
      `telemetry_emit_skipped event=${normalizedEventType} reason=unsupported_event_name`,
    );
    return {
      ok: false,
      reason: "unsupported_event_name",
    };
  }
  const timing = normalizeLifecycleTiming({ startedAt, endedAt, durationMs });
  const fingerprint = trim(incidentFingerprint) || createIncidentFingerprint({
    factory_id: identity.factory_id,
    instance_id: identity.instance_id,
    host_id: identity.host_id,
    kind_id: identity.kind_id,
    runtime_version: identity.runtime_version,
    kind_version: identity.kind_version,
    policy_profile: identity.policy_profile,
    event_type: normalizedEventType,
    status: normalizedStatus,
    run_id: normalizedRunId,
    tick_id: normalizedTickId,
    ...incidentSeed,
  });

  const payload = {
    ...identity,
    run_id: normalizedRunId,
    tick_id: normalizedTickId,
    event_type: normalizedEventType,
    status: normalizedStatus,
    ...timing,
    incident_fingerprint: fingerprint,
    ...extraFields,
  };

  const required = requiredEventDefinitions.find((entry) => trim(entry?.event) === normalizedEventType)?.required_fields || [];
  const missingPayloadFields = required.filter((field) => {
    const value = payload[field];
    if (typeof value === "number") {
      return !Number.isFinite(value);
    }
    return !trim(value);
  });
  if (missingPayloadFields.length > 0) {
    appendLogLineFn(
      daemonLogPath,
      `telemetry_emit_skipped event=${normalizedEventType} reason=missing_required_payload fields=${missingPayloadFields.join(",")}`,
    );
    return {
      ok: false,
      reason: "missing_required_payload",
      missing_fields: missingPayloadFields,
    };
  }

  switch (governedEventName) {
    case "factory.lifecycle.tick":
      emitOtelEventFn({
        event_name: "factory.lifecycle.tick",
        severity_text: normalizedStatus === "failed" ? "WARN" : "INFO",
        correlation: {
          factory_id: payload.factory_id,
          run_id: payload.run_id,
          workflow_id: payload.event_type || "managed_supervisor",
          capability_id: "managed_factory_lifecycle",
          owner: "factory_ops.managed_factory_lifecycle_telemetry",
        },
        attributes: {
          instance_id: payload.instance_id,
          installation_id: payload.installation_id,
          host_id: payload.host_id,
          kind_id: payload.kind_id,
          tick_id: payload.tick_id,
          event_type: payload.event_type,
          status: payload.status,
          incident_fingerprint: payload.incident_fingerprint,
          runtime_version: payload.runtime_version,
          kind_version: payload.kind_version,
          policy_profile: payload.policy_profile,
        },
        body: payload,
      });
      break;
    case "factory.lifecycle.sleep":
      emitOtelEventFn({
        event_name: "factory.lifecycle.sleep",
        severity_text: normalizedStatus === "failed" ? "WARN" : "INFO",
        correlation: {
          factory_id: payload.factory_id,
          run_id: payload.run_id,
          workflow_id: payload.event_type || "managed_supervisor",
          capability_id: "managed_factory_lifecycle",
          owner: "factory_ops.managed_factory_lifecycle_telemetry",
        },
        attributes: {
          instance_id: payload.instance_id,
          installation_id: payload.installation_id,
          host_id: payload.host_id,
          kind_id: payload.kind_id,
          tick_id: payload.tick_id,
          event_type: payload.event_type,
          status: payload.status,
          incident_fingerprint: payload.incident_fingerprint,
          runtime_version: payload.runtime_version,
          kind_version: payload.kind_version,
          policy_profile: payload.policy_profile,
        },
        body: payload,
      });
      break;
    default:
      appendLogLineFn(
        daemonLogPath,
        `telemetry_emit_skipped event=${normalizedEventType} reason=unsupported_event_name`,
      );
      return {
        ok: false,
        reason: "unsupported_event_name",
      };
  }

  appendLogLineFn(
    daemonLogPath,
    `telemetry_emit event=${normalizedEventType} status=${normalizedStatus} run_id=${payload.run_id} tick_id=${payload.tick_id}`,
  );

  return {
    ok: true,
    payload,
  };
}
