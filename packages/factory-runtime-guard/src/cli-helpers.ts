import {
  createBackend,
  resolveBackendSelection,
} from "../../github-adapter/src/create-backend.ts";
import {
  createGhApiClient,
  runGhCli,
} from "../../github-adapter/src/github-adapter.ts";

export {
  createBackend,
  createGhApiClient,
  resolveBackendSelection,
  runGhCli as gh,
};

export { readJsonFile, parseJsonLoose } from "./io.ts";

export function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function ghOrThrow(args: string[]): Record<string, unknown> {
  return ghOrThrowWithOptions(args);
}

function formatGhFailure(result: Record<string, unknown> = {}, fallback: string = "gh command failed"): string {
  const error = result?.error as Record<string, unknown> | undefined;
  const timedOut = error?.code === "ETIMEDOUT" || /timed out/i.test(String(error?.message || ""));
  if (timedOut) {
    const timeoutMs: number = Number(error?.timeout);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
      ? `gh command timed out after ${timeoutMs}ms`
      : "gh command timed out";
  }
  return String(result?.stderr || result?.stdout || fallback);
}

export function ghOrThrowWithOptions(args: string[], options: Record<string, unknown> = {}): Record<string, unknown> {
  const result = runGhCli(args, { options }) as Record<string, unknown>;
  if (!result.ok) throw new Error(formatGhFailure(result));
  return result;
}

export function ghJson(args: string[], fallback: unknown): unknown {
  try {
    return ghJsonWithOptions(args, fallback);
  } catch {
    return fallback;
  }
}

export function ghJsonWithOptions(args: string[], fallback: unknown, options: Record<string, unknown> = {}): unknown {
  const result: Record<string, unknown> = ghOrThrowWithOptions(args, options);
  return parseJson(result.stdout as string, fallback);
}

export function ghJsonPaginated(apiPath: string, fallback: unknown[] = []): unknown[] {
  return (createGhApiClient() as Record<string, Function>).apiPaginatedJson({ apiPath, fallback }) as unknown[];
}

export function ghJsonPaginatedWithOptions(apiPath: string, fallback: unknown[] = [], options: Record<string, unknown> = {}): unknown[] {
  const result: Record<string, unknown> = ghOrThrowWithOptions(["api", apiPath, "--paginate"], options);
  const raw: string = String(result.stdout || "");
  try {
    const normalized: string = `[${raw.replace(/\]\s*\[/g, ",")}]`;
    const parsed: unknown[] = JSON.parse(normalized);
    return Array.isArray(parsed[0]) ? parsed.flat() : parsed;
  } catch {
    try {
      return raw
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .map((line: string) => JSON.parse(line));
    } catch {
      return fallback;
    }
  }
}

function normalizeBackendConfigShape(factoryConfig: Record<string, unknown> = {}): Record<string, unknown> {
  const config: Record<string, unknown> = toPlainObject(factoryConfig);
  return toPlainObject(config.backend);
}

export function resolveBackendConfig({
  factoryConfig = {},
  type,
  storeRoot,
  env = process.env,
}: {
  factoryConfig?: Record<string, unknown>;
  type?: string;
  storeRoot?: string;
  env?: Record<string, string | undefined>;
} = {}): { type: string; storeRoot: string; backendConfig: Record<string, unknown> } {
  const backendConfig: Record<string, unknown> = normalizeBackendConfigShape(factoryConfig);
  const envType: string = trim(env?.HATCH_BACKEND_TYPE || "");
  const envStoreRoot: string = trim(env?.HATCH_BACKEND_STORE_ROOT || "");
  const explicitType: string = trim(type || "");
  const explicitStoreRoot: string = trim(storeRoot || "");

  const resolved = resolveBackendSelection({
    backend: backendConfig,
    type: explicitType || envType || undefined,
    storeRoot: explicitStoreRoot || envStoreRoot || undefined,
    env,
  }) as { type: string; storeRoot: string };

  return {
    type: resolved.type,
    storeRoot: resolved.storeRoot,
    backendConfig,
  };
}

export function createFactoryBackend({
  repo,
  factoryConfig = {},
  type,
  storeRoot,
  env = process.env,
  ...adapterOptions
}: {
  repo?: string;
  factoryConfig?: Record<string, unknown>;
  type?: string;
  storeRoot?: string;
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
} = {}): Record<string, unknown> {
  const resolved = resolveBackendConfig({
    factoryConfig,
    type,
    storeRoot,
    env,
  });

  return createBackend({
    repo,
    type: resolved.type,
    storeRoot: resolved.storeRoot,
    backend: resolved.backendConfig,
    env,
    ...adapterOptions,
  }) as Record<string, unknown>;
}

// Temporary alias while downstream callers migrate to createFactoryBackend.
export const createBackendAdapterFromConfig = createFactoryBackend;

export function toEpochMs(value: unknown): number {
  return Date.parse(String(value || "").trim());
}

export function toPositiveInt(value: unknown): number {
  const n: number = parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function toPlainObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return { ...value } as Record<string, unknown>;
  }
  return {};
}

export function toCommandList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v: unknown) => String(v || "").trim()).filter(Boolean);
}

export function createGhCliAdapter({
  repo,
  type = "",
  storeRoot = "",
  factoryConfigPath = "",
  factoryRoot = "",
  cwd = process.cwd(),
  backend,
  env = process.env,
  ...options
}: {
  repo?: string;
  type?: string;
  storeRoot?: string;
  factoryConfigPath?: string;
  factoryRoot?: string;
  cwd?: string;
  backend?: unknown;
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
} = {}): Record<string, unknown> {
  return createBackend({
    repo,
    type,
    storeRoot,
    factoryConfigPath,
    factoryRoot,
    cwd,
    backend,
    env,
    ...options,
  }) as Record<string, unknown>;
}
