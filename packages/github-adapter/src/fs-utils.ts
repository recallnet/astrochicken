import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

function trim(value: unknown = ""): string {
  return String(value || "").trim();
}

function parseRepoSlug(repo: string = ""): { owner: string; name: string } {
  const normalized = trim(repo).toLowerCase();
  const [owner, name] = normalized.split("/");
  if (!owner || !name) {
    throw new Error(`repo must be an owner/repo slug: ${repo}`);
  }
  return { owner, name };
}

function writeTextAtomicSync(filePath: string = "", payload: string = "", {
  mkdirSyncFn = mkdirSync,
  writeFileSyncFn = writeFileSync,
  renameSyncFn = renameSync,
  unlinkSyncFn = unlinkSync,
}: {
  mkdirSyncFn?: typeof mkdirSync;
  writeFileSyncFn?: typeof writeFileSync;
  renameSyncFn?: typeof renameSync;
  unlinkSyncFn?: typeof unlinkSync;
} = {}): void {
  const targetPath = trim(filePath);
  if (!targetPath) throw new Error("filePath is required");

  mkdirSyncFn(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    writeFileSyncFn(tmpPath, String(payload || ""), "utf8");
    renameSyncFn(tmpPath, targetPath);
  } catch (error) {
    try {
      unlinkSyncFn(tmpPath);
    } catch {
      // no-op
    }
    throw error;
  }
}

export function readJsonFileSync(filePath: string = "", fallback: unknown = null, {
  readFileSyncFn = readFileSync,
  existsSyncFn = existsSync,
}: {
  readFileSyncFn?: typeof readFileSync;
  existsSyncFn?: typeof existsSync;
} = {}): unknown {
  const targetPath = trim(filePath);
  if (!targetPath || !existsSyncFn(targetPath)) {
    return fallback;
  }

  const raw = String(readFileSyncFn(targetPath, "utf8") || "").trim();
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON in file: ${targetPath}`);
  }
}

export function writeJsonAtomicSync(filePath: string = "", value: unknown = null, options: Record<string, unknown> = {}): void {
  const payload = `${JSON.stringify(value ?? null, null, 2)}\n`;
  writeTextAtomicSync(filePath, payload, options as Parameters<typeof writeTextAtomicSync>[2]);
}

export function appendLineAtomicSync(filePath: string = "", line: string = "", {
  readFileSyncFn = readFileSync,
  existsSyncFn = existsSync,
  ...writeOptions
}: {
  readFileSyncFn?: typeof readFileSync;
  existsSyncFn?: typeof existsSync;
  [key: string]: unknown;
} = {}): void {
  const targetPath = trim(filePath);
  if (!targetPath) throw new Error("filePath is required");

  const current = existsSyncFn(targetPath)
    ? String(readFileSyncFn(targetPath, "utf8") || "")
    : "";

  const lineText = String(line || "").trimEnd();
  const next = current + (lineText ? `${lineText}\n` : "");
  writeTextAtomicSync(targetPath, next, writeOptions as Parameters<typeof writeTextAtomicSync>[2]);
}

export function resolveRepoStore(storeRoot: string = "", repo: string = "", {
  mkdirSyncFn = mkdirSync,
}: {
  mkdirSyncFn?: typeof mkdirSync;
} = {}): string {
  const root = trim(storeRoot);
  if (!root) throw new Error("storeRoot is required for local_fs backend");

  const { owner, name } = parseRepoSlug(repo);
  const repoDir = path.join(root, `${owner}~${name}`);
  mkdirSyncFn(repoDir, { recursive: true });
  return repoDir;
}
