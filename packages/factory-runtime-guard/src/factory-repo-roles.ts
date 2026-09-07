import { parseJson, trim } from "./cli-helpers.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values: string[] = []): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeRepoSlug(value: string = ""): string {
  const raw = trim(value).toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("/") || raw.startsWith(".") || raw.startsWith("file://") || raw.includes("\\")) {
    return "";
  }

  const stripped = raw
    .replace(/^git@github\.com:/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  const segments = stripped.split("/").map((segment) => trim(segment)).filter(Boolean);
  if (segments.length !== 2) return "";
  return `${segments[0]}/${segments[1]}`;
}

export function normalizeDestinationRepos(destinationRepos: unknown = []): string[] {
  return unique((Array.isArray(destinationRepos) ? destinationRepos : [])
    .map((entry: unknown) => normalizeRepoSlug(entry as string)));
}

function parseDestinationsObject(destinations: unknown): Record<string, unknown> {
  if (typeof destinations === "string") {
    const raw = trim(destinations);
    if (!raw) return {};
    const parsed = parseJson(raw, null);
    if (!isPlainObject(parsed)) {
      throw new Error("invalid_factory_destinations_json");
    }
    return parsed;
  }

  if (isPlainObject(destinations)) {
    return destinations;
  }

  if (destinations == null) return {};
  throw new Error("invalid_factory_destinations");
}

function extractDestinationRepos(destinations: unknown): string[] {
  const record = parseDestinationsObject(destinations);
  const repos: string[] = [];
  for (const value of Object.values(record)) {
    if (!isPlainObject(value)) continue;
    repos.push(normalizeRepoSlug(String(value.repo || "")));
  }
  return normalizeDestinationRepos(repos);
}

export interface FactoryRepoRoleContext {
  targetRepo: string;
  controlPlaneRepo: string;
  destinationRepos: string[];
}

export function normalizeFactoryRepoRoleContext(context: unknown = {}): FactoryRepoRoleContext {
  const value = isPlainObject(context) ? context : {};
  const targetRepo = normalizeRepoSlug(String(value.targetRepo || ""));
  const controlPlaneRepo = normalizeRepoSlug(String(value.controlPlaneRepo || ""));
  const destinationRepos = normalizeDestinationRepos(value.destinationRepos || []);

  return {
    targetRepo,
    controlPlaneRepo,
    destinationRepos,
  };
}

export function hasFactoryRepoRoleContext(context: unknown = {}): boolean {
  const normalized = normalizeFactoryRepoRoleContext(context);
  return Boolean(normalized.targetRepo || normalized.controlPlaneRepo || normalized.destinationRepos.length > 0);
}

export function buildFactoryRepoRoleContext({
  targetRepo = "",
  controlPlaneRepo = "",
  destinations = {},
}: {
  targetRepo?: string;
  controlPlaneRepo?: string;
  destinations?: unknown;
} = {}): FactoryRepoRoleContext {
  const normalizedTargetRepo = normalizeRepoSlug(targetRepo);
  const normalizedControlPlaneRepo = normalizeRepoSlug(controlPlaneRepo);
  const destinationRepos = extractDestinationRepos(destinations);

  return normalizeFactoryRepoRoleContext({
    targetRepo: normalizedTargetRepo,
    controlPlaneRepo: normalizedControlPlaneRepo,
    destinationRepos,
  });
}

export function buildFactoryRepoRoleContextFromFactory({ context = {}, config = {} }: { context?: unknown; config?: unknown } = {}): FactoryRepoRoleContext {
  const contextRecord = isPlainObject(context) ? context : {};
  const configRecord = isPlainObject(config) ? config : {};

  const contextDestinations = trim(String(contextRecord.destinations_json || ""));
  const configDestinations = configRecord.destinations;

  return buildFactoryRepoRoleContext({
    targetRepo: String(contextRecord.target_repo || configRecord.target_repo || ""),
    controlPlaneRepo: String(contextRecord.control_plane_repo || configRecord.control_plane_repo || ""),
    destinations: contextDestinations || configDestinations || {},
  });
}

export function readFactoryRepoRoleContextFromEnv({ env = process.env }: { env?: Record<string, string | undefined> } = {}): FactoryRepoRoleContext {
  const raw = trim(String(env?.HATCH_FACTORY_REPO_ROLES_JSON || ""));
  if (!raw) return normalizeFactoryRepoRoleContext();

  const parsed = parseJson(raw, null);
  if (!isPlainObject(parsed)) {
    throw new Error("invalid_hatch_factory_repo_roles_json");
  }
  return normalizeFactoryRepoRoleContext(parsed);
}

export function buildGuardRepoRoleOptions({
  explicitContext = null,
  repoSlug = "",
  fallbackRepoSlug = "",
  env = process.env,
  enforceWhenContextPresent = true,
}: {
  explicitContext?: unknown;
  repoSlug?: string;
  fallbackRepoSlug?: string;
  env?: Record<string, string | undefined>;
  enforceWhenContextPresent?: boolean;
} = {}): FactoryRepoRoleContext & { repoSlug: string; enforceRepoRoles: boolean } {
  const explicit = normalizeFactoryRepoRoleContext(explicitContext || {});
  const envContext = hasFactoryRepoRoleContext(explicit)
    ? normalizeFactoryRepoRoleContext()
    : readFactoryRepoRoleContextFromEnv({ env });
  const context = hasFactoryRepoRoleContext(explicit) ? explicit : envContext;

  const normalizedRepoSlug = normalizeRepoSlug(repoSlug)
    || normalizeRepoSlug(fallbackRepoSlug)
    || normalizeRepoSlug(context.controlPlaneRepo)
    || normalizeRepoSlug(context.targetRepo);

  return {
    ...context,
    repoSlug: normalizedRepoSlug,
    enforceRepoRoles: Boolean(enforceWhenContextPresent && hasFactoryRepoRoleContext(context)),
  };
}
