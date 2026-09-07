import { promises as fsPromises } from "node:fs";
import path from "node:path";

import { resolveFleetDatasetSummary } from "./fleet-lens-collector.ts";

const DEFAULT_COLLECTOR_VERSION = "1";

function asString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function normalizeDatasetId(datasetId = "") {
  const normalized = asString(datasetId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    throw new Error(`lens_dataset_invalid_id: dataset_id=${asString(datasetId) || "(empty)"}`);
  }
  return normalized;
}

function getByPath(source = {}, pathSegments = []) {
  return pathSegments.reduce((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return current[segment];
  }, source);
}

function toBundlePath(pathSegments = []) {
  if (pathSegments.length === 0) return "$";
  return `$.${pathSegments.join(".")}`;
}

function resolveDatasetWindow(datasetPayload = {}, fallbackWindow = {}) {
  return {
    start: asString(datasetPayload?.window?.start || fallbackWindow?.start),
    end: asString(datasetPayload?.window?.end || fallbackWindow?.end),
  };
}

const MAX_META_ERROR_LENGTH = 1024;

function summarizeMetaError(metaError = "", missingDataCount = 0) {
  const raw = asString(metaError);
  if (!raw || raw.length <= MAX_META_ERROR_LENGTH) return raw;
  const parts = raw.split("; ").filter(Boolean);
  const counts = new Map();
  for (const part of parts) {
    counts.set(part, (counts.get(part) || 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, count]) => count > 1 ? `${msg} (×${count})` : msg)
    .join("; ");
  const suffix = missingDataCount > 0
    ? ` [${missingDataCount} missing data entries total]`
    : ` [${parts.length} error entries total]`;
  return `${summary}${suffix}`;
}

function resolveDatasetCollectorHealth({ datasetId = "", datasetPayload = {} } = {}) {
  const payload = toObject(datasetPayload);
  const metaError = asString(payload?.meta?.error);
  const missingData = toArray(payload?.missing_data);
  const errorStrings = [
    metaError,
    ...missingData
      .map((entry) => asString(entry?.detail || entry?.reason || entry))
      .filter(Boolean),
  ].filter(Boolean);

  const healthFlags = [];
  if (metaError) healthFlags.push("collector_error");
  if (missingData.length > 0) healthFlags.push("missing_data");

  const pendingSuggestionCount = datasetId === "pending_suggestions"
    ? toArray(datasetPayload).length
    : 0;
  if (datasetId === "pending_suggestions" && pendingSuggestionCount > 0) {
    healthFlags.push("pending_suggestions");
  }

  const status = healthFlags.includes("collector_error") || healthFlags.includes("missing_data")
    ? "degraded"
    : healthFlags.length > 0
      ? "attention"
      : "ok";

  const cappedMetaError = summarizeMetaError(metaError, missingData.length);

  return {
    status,
    meta_error: cappedMetaError,
    error_strings: errorStrings.length <= 10
      ? errorStrings
      : [...errorStrings.slice(0, 5), `… and ${errorStrings.length - 5} more`],
    health_flags: healthFlags,
    missing_data_count: missingData.length,
    collector_error_count: (metaError ? 1 : 0) + missingData.length,
    ...(datasetId === "pending_suggestions"
      ? { pending_suggestions_count: pendingSuggestionCount }
      : {}),
  };
}

function resolveDatasetSummary({ datasetId = "", datasetPayload = {} } = {}) {
  const payload = datasetPayload;

  switch (datasetId) {
    case "langfuse": {
      const traces = toArray(payload?.traces);
      const sampledTraces = toArray(payload?.sampled_traces);
      const totals = toObject(payload?.totals);
      return {
        item_count: traces.length,
        trace_count: toNumber(payload?.trace_count, traces.length),
        sampled_trace_count: sampledTraces.length,
        judge_scope_identity_count: toArray(payload?.judge_context_scope_identities).length,
        by_skill_count: toArray(payload?.by_skill).length,
        by_model_count: toArray(payload?.by_model).length,
        totals: {
          trace_count: toNumber(totals?.trace_count, traces.length),
          tokens_total: toNumber(totals?.tokens_total, 0),
          cost_total_usd: toNumber(totals?.cost_total_usd, 0),
        },
      };
    }
    case "langfuse_metrics": {
      const totals = toObject(payload?.totals);
      const latency = toObject(payload?.latency);
      return {
        item_count: toArray(payload?.by_model).length,
        trace_count: toNumber(totals?.trace_count, 0),
        tokens_total: toNumber(totals?.tokens_total, 0),
        cost_total_usd: toNumber(totals?.cost_total_usd, 0),
        latency_p50_ms: toNumber(latency?.p50_ms, 0),
        latency_p90_ms: toNumber(latency?.p90_ms, 0),
        by_model_count: toArray(payload?.by_model).length,
      };
    }
    case "github": {
      const issues = toArray(payload?.issues);
      const pullRequests = toArray(payload?.pull_requests);
      return {
        item_count: issues.length + pullRequests.length,
        issues_count: issues.length,
        pull_requests_count: pullRequests.length,
        issues_created_count: toNumber(payload?.issue_counts?.created, 0),
        issues_closed_count: toNumber(payload?.issue_counts?.closed, 0),
        pull_requests_merged_count: toNumber(payload?.pull_request_counts?.merged, 0),
        pull_requests_updated_count: toNumber(payload?.pull_request_counts?.updated, pullRequests.length),
        open_bug_count: toNumber(payload?.bug_gate?.open_bug_count, 0),
      };
    }
    case "git": {
      const commits = toArray(payload?.commits);
      return {
        item_count: commits.length,
        commit_count: toNumber(payload?.commit_count, commits.length),
        stray_branches_count: toNumber(payload?.stray_branches_count, toArray(payload?.stray_branches).length),
      };
    }
    case "hatch_runs": {
      const runs = toArray(payload?.runs);
      const counts = toObject(payload?.counts);
      return {
        item_count: runs.length,
        runs_count: runs.length,
        total_runs_count: toNumber(counts?.total_runs, runs.length),
        runs_in_window_count: toNumber(counts?.runs_in_window, runs.length),
        guarded_runs_count: toNumber(counts?.guarded_runs, 0),
        guard_incidents_count: toArray(payload?.guard_incidents).length,
      };
    }
    case "supervisor": {
      const runs = toArray(payload?.runs);
      const ticks = toArray(payload?.ticks);
      const counts = toObject(payload?.counts);
      return {
        item_count: runs.length + ticks.length,
        runs_count: runs.length,
        ticks_count: ticks.length,
        active_runs_count: toNumber(counts?.active_runs, runs.length),
        active_ticks_count: toNumber(counts?.active_ticks, ticks.length),
        guard_activations_count: toNumber(counts?.guard_activations, 0),
      };
    }
    case "agent_learnings": {
      const entries = toArray(payload?.entries);
      return {
        item_count: entries.length,
        entries_count: entries.length,
        source_path: asString(payload?.path),
      };
    }
    case "past_lens_outputs": {
      const outputs = toArray(payload);
      return {
        item_count: outputs.length,
        report_count: outputs.length,
        dates: outputs.map((entry) => asString(entry?.date)).filter(Boolean),
      };
    }
    case "pending_suggestions": {
      const suggestions = toArray(payload);
      const explicitlyPendingCount = suggestions.filter((entry) => asString(entry?.status).toLowerCase() === "pending").length;
      const pendingCount = explicitlyPendingCount > 0 ? explicitlyPendingCount : suggestions.length;
      return {
        item_count: suggestions.length,
        suggestions_count: suggestions.length,
        pending_count: pendingCount,
      };
    }
    case "llm_inventory":
    case "goal_decomposition_timeouts": {
      const objectPayload = toObject(payload);
      const keys = Object.keys(objectPayload).filter((key) => key !== "path");
      return {
        item_count: keys.length,
        key_count: keys.length,
        keys: keys.slice(0, 20),
        source_path: asString(objectPayload?.path),
      };
    }
    case "managed_fleet":
      return resolveFleetDatasetSummary(payload);
    default:
      if (Array.isArray(payload)) {
        return { item_count: payload.length };
      }
      if (payload && typeof payload === "object") {
        return { item_count: Object.keys(payload).length };
      }
      return { item_count: 0 };
  }
}

async function assertDatasetFileExists({ runtimeFs = fsPromises, datasetId = "", datasetPath = "" } = {}) {
  const normalizedPath = asString(datasetPath);
  if (!normalizedPath) {
    throw new Error(`lens_bundle_manifest_invalid: datasets[].file_path is required for dataset_id=${datasetId || "(empty)"}`);
  }

  if (typeof runtimeFs.access === "function") {
    await runtimeFs.access(normalizedPath);
    return;
  }

  if (typeof runtimeFs.readFile === "function") {
    await runtimeFs.readFile(normalizedPath, "utf8");
    return;
  }

  throw new Error(`lens_bundle_manifest_invalid: runtime fs cannot verify dataset file path=${normalizedPath}`);
}

export async function materializeDatasetFile({
  runtimeFs = fsPromises,
  runtimeDir = "",
  datasetId = "",
  datasetPayload = {},
} = {}) {
  const normalizedRuntimeDir = asString(runtimeDir);
  if (!normalizedRuntimeDir) {
    throw new Error("lens_dataset_materialize_failed: runtime_dir is required");
  }

  const safeDatasetId = normalizeDatasetId(datasetId);
  const datasetsDir = path.join(normalizedRuntimeDir, "datasets");
  const datasetPath = path.join(datasetsDir, `${safeDatasetId}.json`);

  try {
    await runtimeFs.mkdir(datasetsDir, { recursive: true });
    await runtimeFs.writeFile(datasetPath, `${JSON.stringify(datasetPayload ?? {}, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(
      `lens_dataset_materialize_failed: dataset_id=${safeDatasetId} path=${datasetPath} message=${String(error?.message || error)}`,
    );
  }

  try {
    await assertDatasetFileExists({
      runtimeFs,
      datasetId: safeDatasetId,
      datasetPath,
    });
  } catch (error) {
    throw new Error(
      `lens_bundle_manifest_invalid: dataset file missing dataset_id=${safeDatasetId} path=${datasetPath} message=${String(error?.message || error)}`,
    );
  }

  return {
    path: datasetPath,
    itemCount: toNumber(resolveDatasetSummary({ datasetId: safeDatasetId, datasetPayload })?.item_count, 0),
    collectorHealth: resolveDatasetCollectorHealth({ datasetId: safeDatasetId, datasetPayload }),
  };
}

function validateManifestShape(manifest = {}) {
  const requiredTopLevel = [
    "bundle_path",
    "analysis_output_path",
    "repo_path",
    "runs_dir",
  ];

  for (const field of requiredTopLevel) {
    if (!asString(manifest?.[field])) {
      throw new Error(`lens_bundle_manifest_invalid: ${field} is required`);
    }
  }

  const datasets = toArray(manifest?.datasets);
  if (datasets.length === 0) {
    throw new Error("lens_bundle_manifest_invalid: datasets[] is required");
  }

  for (const dataset of datasets) {
    if (!asString(dataset?.id)) {
      throw new Error("lens_bundle_manifest_invalid: datasets[].id is required");
    }
    if (!asString(dataset?.file_path)) {
      throw new Error(`lens_bundle_manifest_invalid: datasets[].file_path is required for dataset_id=${asString(dataset?.id) || "(empty)"}`);
    }
    if (!asString(dataset?.path_in_bundle)) {
      throw new Error(`lens_bundle_manifest_invalid: datasets[].path_in_bundle is required for dataset_id=${asString(dataset?.id) || "(empty)"}`);
    }
  }
}

function resolveDatasetFilePath({
  datasetDef = {},
  datasetPayload = {},
  bundlePath = "",
  materializedPath = "",
} = {}) {
  if (asString(materializedPath)) return asString(materializedPath);

  const payloadPath = asString(datasetPayload?.path);
  if (payloadPath) return payloadPath;

  if (typeof datasetDef.resolveFilePath === "function") {
    const resolved = asString(datasetDef.resolveFilePath(datasetPayload));
    if (resolved) return resolved;
  }

  return asString(bundlePath);
}

function resolveManifestCollectorHealth(datasets = [], pendingSuggestionCount = 0) {
  const collectorHealth = Object.fromEntries(
    datasets.map((dataset) => [dataset.id, { ...toObject(dataset.collector_health) }]),
  );

  if (collectorHealth.pending_suggestions) {
    collectorHealth.pending_suggestions = {
      ...collectorHealth.pending_suggestions,
      pending_suggestions_count: pendingSuggestionCount,
      ...(pendingSuggestionCount > 0
        ? { health_flags: Array.from(new Set([...(toArray(collectorHealth.pending_suggestions.health_flags)), "pending_suggestions"])) }
        : {}),
    };
  } else {
    collectorHealth.pending_suggestions = {
      status: pendingSuggestionCount > 0 ? "attention" : "ok",
      meta_error: "",
      error_strings: [],
      health_flags: pendingSuggestionCount > 0 ? ["pending_suggestions"] : [],
      missing_data_count: 0,
      collector_error_count: 0,
      pending_suggestions_count: pendingSuggestionCount,
    };
  }

  return collectorHealth;
}

export async function buildLensManifest({
  collected = {},
  runtimeFs = fsPromises,
  runtimeDir = "",
  date = "",
  repo = "",
  factoryId = "mothership",
  window = {},
  bundlePath = "",
  analysisOutputPath = "",
  repoPath = ".",
  runsDir = ".hatch/runs",
  issueLabels = [],
  collectorVersion = DEFAULT_COLLECTOR_VERSION,
  generatedAt = new Date().toISOString(),
} = {}) {
  const datasetDefs = [
    { id: "langfuse", type: "telemetry", pathSegments: ["base", "langfuse"], materialize: true, defaultValue: {} },
    { id: "langfuse_metrics", type: "telemetry", pathSegments: ["base", "langfuse_metrics"], materialize: true, defaultValue: {} },
    { id: "github", type: "scm", pathSegments: ["base", "github"], materialize: true, defaultValue: {} },
    { id: "git", type: "vcs", pathSegments: ["base", "git"], materialize: true, defaultValue: {} },
    { id: "hatch_runs", type: "runtime", pathSegments: ["base", "hatch_runs"], materialize: true, defaultValue: {} },
    { id: "supervisor", type: "runtime", pathSegments: ["base", "supervisor"], materialize: true, defaultValue: {} },
    { id: "managed_fleet", type: "fleet", pathSegments: ["base", "managed_fleet"], materialize: true, defaultValue: {} },
    { id: "agent_learnings", type: "knowledge", pathSegments: ["agent_learnings"], defaultValue: {} },
    { id: "past_lens_outputs", type: "reports", pathSegments: ["past_lens_outputs"], defaultValue: [] },
    { id: "pending_suggestions", type: "feedback", pathSegments: ["pending_suggestions"], defaultValue: [] },
    { id: "llm_inventory", type: "inventory", pathSegments: ["llm_inventory"], defaultValue: {} },
    { id: "goal_decomposition_timeouts", type: "inventory", pathSegments: ["goal_decomposition_timeouts"], defaultValue: {} },
  ];

  const datasets = [];
  const materializedDatasets = [];

  for (const datasetDef of datasetDefs) {
    const datasetPayload = getByPath(collected, datasetDef.pathSegments) ?? datasetDef.defaultValue;
    let materializedPath = "";
    let collectorHealth = resolveDatasetCollectorHealth({ datasetId: datasetDef.id, datasetPayload });

    if (datasetDef.materialize) {
      const materialized = await materializeDatasetFile({
        runtimeFs,
        runtimeDir,
        datasetId: datasetDef.id,
        datasetPayload,
      });
      materializedPath = materialized.path;
      collectorHealth = materialized.collectorHealth;
      materializedDatasets.push({ id: datasetDef.id, path: materialized.path });
    }

    const filePath = resolveDatasetFilePath({
      datasetDef,
      datasetPayload,
      bundlePath,
      materializedPath,
    });

    datasets.push({
      id: datasetDef.id,
      type: datasetDef.type,
      summary: resolveDatasetSummary({ datasetId: datasetDef.id, datasetPayload }),
      file_path: filePath,
      path: filePath,
      path_in_bundle: toBundlePath(datasetDef.pathSegments),
      window: resolveDatasetWindow(datasetPayload, window),
      collector_health: collectorHealth,
    });
  }

  const pendingSuggestionCount = toArray(collected?.pending_suggestions).length;
  const collectorHealth = resolveManifestCollectorHealth(datasets, pendingSuggestionCount);

  const manifest = {
    date: asString(date),
    repo: asString(repo),
    factory_id: asString(factoryId),
    window: {
      start: asString(window?.start),
      end: asString(window?.end),
    },
    bundle_path: asString(bundlePath),
    analysis_output_path: asString(analysisOutputPath),
    issue_labels: toArray(issueLabels),
    repo_path: asString(repoPath),
    runs_dir: asString(runsDir),
    provenance: {
      collector_version: asString(collectorVersion || DEFAULT_COLLECTOR_VERSION),
      generated_at: asString(generatedAt) || new Date().toISOString(),
      runs_dir: asString(runsDir),
    },
    datasets,
    collector_health: collectorHealth,
    summary: {
      dataset_count: datasets.length,
      collector_error_count: datasets.filter((dataset) => Number(dataset?.collector_health?.collector_error_count || 0) > 0).length,
      pending_suggestion_count: pendingSuggestionCount,
      prior_report_count: toArray(collected?.past_lens_outputs).length,
    },
  };

  validateManifestShape(manifest);
  await Promise.all(
    materializedDatasets.map((dataset) => assertDatasetFileExists({
      runtimeFs,
      datasetId: dataset.id,
      datasetPath: dataset.path,
    })),
  );

  return manifest;
}
