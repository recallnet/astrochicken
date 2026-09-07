import { defineBoundarySchema, z } from "@hatch/factory-core/schema-registry";

const BACKEND_TYPES: readonly string[] = Object.freeze([
  "github",
  "local_fs",
]);

export const BACKEND_SELECTION_SCHEMA = Object.freeze({
  top_level_keys: Object.freeze([
    "type",
    "store_root",
    "storeRoot",
  ]),
  backend_types: BACKEND_TYPES,
  env: Object.freeze({
    type: "HATCH_BACKEND_TYPE",
    store_root: "HATCH_BACKEND_STORE_ROOT",
  }),
});

const backendSelectionConfigSchema = z.object({
  type: z.string().trim().min(1).optional(),
  store_root: z.string().trim().min(1).optional(),
  storeRoot: z.string().trim().min(1).optional(),
}).strict();

export const BACKEND_SELECTION_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: "https://recallnet.dev/contracts/backend-selection-config.json",
  version: "backend_selection_config/v1",
  title: "Backend Selection Config",
  description: "Versioned backend selection contract for Hatch backend resolution.",
  schema: backendSelectionConfigSchema,
  sourcePath: "packages/github-adapter/src/backend-selection-schema.ts",
  outputPath: "docs/contracts/backend-selection-config.json",
});

function trim(value: unknown = ""): string {
  return String(value || "").trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeType(value: unknown = ""): string {
  return trim(value).toLowerCase();
}

function parseConfiguredStoreRoot(config: Record<string, unknown> = {}): { ok: boolean; error: string; value: string } {
  const hasCamel = Object.prototype.hasOwnProperty.call(config, "storeRoot");
  const hasSnake = Object.prototype.hasOwnProperty.call(config, "store_root");
  const camel = hasCamel ? trim(config.storeRoot) : "";
  const snake = hasSnake ? trim(config.store_root) : "";

  if (hasCamel && typeof config.storeRoot !== "string") {
    return {
      ok: false,
      error: "backend.storeRoot must be a non-empty string",
      value: "",
    };
  }

  if (hasSnake && typeof config.store_root !== "string") {
    return {
      ok: false,
      error: "backend.store_root must be a non-empty string",
      value: "",
    };
  }

  if ((hasCamel && !camel) || (hasSnake && !snake)) {
    return {
      ok: false,
      error: hasCamel ? "backend.storeRoot must be a non-empty string" : "backend.store_root must be a non-empty string",
      value: "",
    };
  }

  if (camel && snake && camel !== snake) {
    return {
      ok: false,
      error: "backend.storeRoot and backend.store_root must match when both are provided",
      value: "",
    };
  }

  return {
    ok: true,
    error: "",
    value: camel || snake || "",
  };
}

export function validateBackendSelectionConfig(config: unknown = {}): { ok: boolean; errors: string[] } {
  if (config === null || config === undefined) {
    return { ok: true, errors: [] };
  }

  if (!isPlainObject(config)) {
    return {
      ok: false,
      errors: ["backend config must be an object"],
    };
  }

  const errors: string[] = [];
  const result = backendSelectionConfigSchema.safeParse(config);
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of (issue as unknown as { keys: string[] }).keys) {
          errors.push(`unknown backend config key: ${key}`);
        }
        continue;
      }

      const path = issue.path.join(".");
      if (path === "type") {
        errors.push("backend.type must be a non-empty string");
        continue;
      }
      if (path === "storeRoot") {
        errors.push("backend.storeRoot must be a non-empty string");
        continue;
      }
      if (path === "store_root") {
        errors.push("backend.store_root must be a non-empty string");
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, "type")) {
    if (typeof config.type !== "string" || !trim(config.type)) {
      errors.push("backend.type must be a non-empty string");
    } else {
      const normalized = normalizeType(config.type);
      if (!BACKEND_TYPES.includes(normalized)) {
        errors.push(`unknown backend type: ${normalized}. supported types: ${BACKEND_TYPES.join(", ")}`);
      }
    }
  }

  const storeRoot = parseConfiguredStoreRoot(config);
  if (!storeRoot.ok) {
    errors.push(storeRoot.error);
  }

  const configuredType = normalizeType(config.type || "");
  if (configuredType === "local_fs" && storeRoot.ok && !storeRoot.value) {
    errors.push("storeRoot is required for local_fs backend");
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

export function resolveBackendSelection({
  backend = {},
  type,
  storeRoot,
  env = process.env,
}: {
  backend?: Record<string, unknown>;
  type?: string;
  storeRoot?: string;
  env?: Record<string, string | undefined>;
} = {}): { type: string; storeRoot: string } {
  const validation = validateBackendSelectionConfig(backend);
  if (!validation.ok) {
    throw new Error(`backend config validation failed: ${validation.errors.join("; ")}`);
  }

  const normalizedBackend = isPlainObject(backend) ? backend : {};

  const resolvedType = normalizeType(type || env?.HATCH_BACKEND_TYPE || normalizedBackend.type || "github");
  if (!BACKEND_TYPES.includes(resolvedType)) {
    throw new Error(`unknown backend type: ${resolvedType}. supported types: ${BACKEND_TYPES.join(", ")}`);
  }

  const configuredStoreRoot = parseConfiguredStoreRoot(normalizedBackend);
  const resolvedStoreRoot = trim(storeRoot || env?.HATCH_BACKEND_STORE_ROOT || configuredStoreRoot.value || "");

  if (resolvedType === "local_fs" && !resolvedStoreRoot) {
    throw new Error("storeRoot is required for local_fs backend");
  }

  return {
    type: resolvedType,
    storeRoot: resolvedStoreRoot,
  };
}

export { BACKEND_TYPES };
