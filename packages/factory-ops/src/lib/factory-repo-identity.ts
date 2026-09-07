import { parseJson, trim } from "./cli-helpers.ts";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRepoLike(value = "") {
  if (typeof value === "string") return trim(value);
  if (!isPlainObject(value)) return "";
  return trim(value.full_name || value.repo || "");
}

function normalizeFactoryId(value = "") {
  return trim(value);
}

function normalizeDestinationLabels(value = [], destinationKey = "") {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[factory-repo-identity] destinations.${destinationKey}.labels must be an array`);
  }
  return Array.from(new Set(value.map((entry) => trim(entry)).filter(Boolean)));
}

function parseDestinationsRecord(value = {}) {
  if (typeof value === "string") {
    const raw = trim(value);
    if (!raw) return {};
    const parsed = parseJson(raw, null);
    if (!isPlainObject(parsed)) {
      throw new Error("[factory-repo-identity] destinations must be a JSON object");
    }
    return parsed;
  }
  if (value == null) return {};
  if (!isPlainObject(value)) {
    throw new Error("[factory-repo-identity] destinations must be a JSON object");
  }
  return value;
}

export function resolveDestinationsFromContext(context = {}) {
  const record = isPlainObject(context) ? context : {};
  const destinationsValue = record.destinations_json ?? record.destinations;
  return parseDestinationsRecord(destinationsValue);
}

export function resolveTargetRepoFromContext(
  context = {},
  {
    factoryId = "",
    requireResolved = true,
  } = {},
) {
  const record = isPlainObject(context) ? context : {};
  const resolvedFactoryId = normalizeFactoryId(factoryId || record.factory_id);
  const targetRepo = normalizeRepoLike(record.target_repo);
  if (targetRepo) return targetRepo;

  if (!requireResolved) return "";
  throw new Error(
    `[factory-repo-identity] unable to resolve target_repo for factory_id=${resolvedFactoryId || "(unresolved)"}; set target_repo in .hatch/instance.json or pass --repo`,
  );
}

export function resolveTargetRepoFromConfig(
  config = {},
  {
    factoryId = "",
    requireResolved = true,
  } = {},
) {
  const record = isPlainObject(config) ? config : {};
  const resolvedFactoryId = normalizeFactoryId(factoryId || record.factory_id);
  const targetRepo = normalizeRepoLike(record.target_repo);
  if (targetRepo) return targetRepo;

  if (!requireResolved) return "";
  throw new Error(
    `[factory-repo-identity] unable to resolve target_repo for factory_id=${resolvedFactoryId || "(unresolved)"}; declare target_repo in config`,
  );
}

export function resolveDestinationRoute(context = {}, destinationKey = "") {
  const normalizedDestinationKey = trim(destinationKey);
  if (!normalizedDestinationKey) {
    throw new Error("[factory-repo-identity] destination key is required");
  }

  const destinations = resolveDestinationsFromContext(context);
  const route = destinations[normalizedDestinationKey];
  if (!isPlainObject(route)) {
    throw new Error(`[factory-repo-identity] missing destinations.${normalizedDestinationKey} route`);
  }

  const repo = normalizeRepoLike(route.repo);
  if (!repo) {
    throw new Error(`[factory-repo-identity] destinations.${normalizedDestinationKey}.repo is required`);
  }

  const labels = Array.from(new Set([
    "goal",
    ...normalizeDestinationLabels(route.labels, normalizedDestinationKey),
  ]));

  return {
    destination_key: normalizedDestinationKey,
    repo,
    labels,
  };
}

export function resolveDestinationRepo(context = {}, destinationKey = "") {
  const normalizedDestinationKey = trim(destinationKey);
  if (!normalizedDestinationKey) return "";

  const destinations = resolveDestinationsFromContext(context);
  const route = destinations[normalizedDestinationKey];
  if (!isPlainObject(route)) return "";
  return normalizeRepoLike(route.repo);
}

export function resolvePrimaryOpsRepo({
  context = {},
  factoryId = "",
  requireResolved = true,
} = {}) {
  const record = isPlainObject(context) ? context : {};
  const resolvedFactoryId = normalizeFactoryId(factoryId || record.factory_id);
  const targetRepo = resolveTargetRepoFromContext(record, {
    factoryId: resolvedFactoryId,
    requireResolved,
  });

  return {
    factory_id: resolvedFactoryId,
    target_repo: targetRepo,
    primary_repo: targetRepo,
    destinations: resolveDestinationsFromContext(record),
  };
}
