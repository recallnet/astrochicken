import { readFileSync } from "node:fs";
import { join } from "node:path";

import { trim } from "../lib/cli-helpers.ts";
import { resolveTargetRepoFromConfig } from "../lib/factory-repo-identity.ts";

const DEFAULT_FACTORY_ROOT = "factories/mothership";
const DEFAULT_FACTORY_CONFIG_FILENAME = "factory.config.json";
const DEFAULT_REQUIRED_FACTORY_CONFIG_KEYS = Object.freeze([
  "factory_id",
  "target_repo",
  "control_plane_repo",
  "tracking_issue",
  "model",
  "provider",
]);


function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseIssueNumber(value = "") {
  const raw = trim(value);
  if (!raw) return "";
  const direct = raw.match(/^\d+$/);
  if (direct) return String(Number.parseInt(direct[0], 10));
  const issueUrl = raw.match(/\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (issueUrl?.[1]) return String(Number.parseInt(issueUrl[1], 10));
  return "";
}

function resolveFactoryRoot({ factoryRoot = "" } = {}) {
  const explicit = trim(factoryRoot);
  if (explicit) return explicit;
  const fromEnv = trim(process.env.HATCH_FACTORY_ROOT || process.env.FACTORY_ROOT || "");
  return fromEnv || DEFAULT_FACTORY_ROOT;
}

function resolveFactoryConfigPath({ factoryRoot = "", configPath = "" } = {}) {
  const explicit = trim(configPath);
  if (explicit) return explicit;
  const resolvedFactoryRoot = resolveFactoryRoot({ factoryRoot });
  return join(resolvedFactoryRoot, DEFAULT_FACTORY_CONFIG_FILENAME);
}

export function loadFactoryConfig({
  factoryRoot = "",
  configPath = "",
  requiredKeys = DEFAULT_REQUIRED_FACTORY_CONFIG_KEYS,
} = {}) {
  const resolvedFactoryRoot = resolveFactoryRoot({ factoryRoot });
  const resolvedConfigPath = resolveFactoryConfigPath({ factoryRoot: resolvedFactoryRoot, configPath });

  let parsed;
  try {
    const raw = readFileSync(resolvedConfigPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to read factory config at ${resolvedConfigPath}: ${String(error?.message || error)}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`Factory config at ${resolvedConfigPath} must be a JSON object`);
  }

  const required = Array.from(new Set(
    (Array.isArray(requiredKeys) ? requiredKeys : [])
      .map((key) => trim(key))
      .filter(Boolean),
  ));

  if (required.length > 0) {
    const REPO_ALIASES = { target_repo: "target_repo" };
    const hasNonEmptyKey = (key) => {
      const value = parsed?.[key];
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && !value.trim()) return false;
      return true;
    };
    const missing = required.filter((key) => {
      if (hasNonEmptyKey(key)) return false;
      const alias = REPO_ALIASES[key];
      if (alias && hasNonEmptyKey(alias)) return false;
      return true;
    });

    if (missing.length > 0) {
      throw new Error(`Factory config at ${resolvedConfigPath} is missing required keys: ${missing.join(", ")}`);
    }
  }

  return {
    factoryRoot: resolvedFactoryRoot,
    configPath: resolvedConfigPath,
    config: parsed,
  };
}

function resolveFactoryId(config = {}) {
  const factoryId = trim(config?.factory_id);
  if (!factoryId) throw new Error("factory.config.json missing required key: factory_id");
  return factoryId;
}

export function resolveTargetRepo(config = {}, { factoryId = "" } = {}) {
  const resolvedFactoryId = trim(factoryId || resolveFactoryId(config));
  return resolveTargetRepoFromConfig(config, {
    factoryId: resolvedFactoryId,
    requireResolved: true,
  });
}

export function resolveControlPlaneRepo(config = {}) {
  const controlPlaneRepo = trim(config?.control_plane_repo);
  if (!controlPlaneRepo) throw new Error("factory.config.json missing required key: control_plane_repo");
  return controlPlaneRepo;
}

function resolveTrackingIssueNumber(config = {}) {
  return parseIssueNumber(config?.tracking_issue);
}
