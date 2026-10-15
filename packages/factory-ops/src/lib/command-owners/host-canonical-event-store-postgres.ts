import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

function trim(value = "") {
  return String(value || "").trim();
}

function resolveComposeTemplatePath() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "config",
    "postgres",
    "canonical-event-store.compose.yml",
  );
}

function parseEnvFile(text = "") {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return env;
}

function defaultEnv({ paths, postgresPort = "55432" } = {}) {
  return {
    CANONICAL_EVENT_STORE_PROJECT: "astrochicken-canonical-event-store",
    CANONICAL_EVENT_STORE_ROOT: paths.stateRoot,
    POSTGRES_DB: "astrochicken_factory",
    POSTGRES_USER: "astrochicken",
    POSTGRES_PASSWORD: "astrochicken",
    POSTGRES_PORT: String(postgresPort || "55432"),
  };
}

function buildEnvText(values = {}) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n")}\n`;
}

function runCommand(args, { cwd, env, input } = {}) {
  const result = spawnSync("docker", args, {
    cwd,
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || `docker_command_failed:status=${result.status}`);
  }

  return String(result.stdout || "");
}

function readBootstrapEnv(paths) {
  return parseEnvFile(readFileSync(paths.envPath, "utf8"));
}

function composeInvocation(paths) {
  return ["compose", "-p", readBootstrapEnv(paths).CANONICAL_EVENT_STORE_PROJECT, "-f", paths.composePath, "--env-file", paths.envPath];
}

function psqlExec(paths, sql) {
  const env = readBootstrapEnv(paths);
  return runCommand(
    [...composeInvocation(paths), "exec", "-T", "postgres", "env", `PGPASSWORD=${env.POSTGRES_PASSWORD}`, "psql", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB, "-Atqc", sql],
  );
}

export function resolveCanonicalEventStoreBootstrapPaths({ repoRoot = process.cwd(), stateRoot = "" } = {}) {
  const resolvedRepoRoot = path.resolve(trim(repoRoot) || process.cwd());
  const resolvedStateRoot = path.resolve(
    trim(stateRoot) || path.join(resolvedRepoRoot, ".hatch", "postgres", "canonical-event-store"),
  );
  return {
    repoRoot: resolvedRepoRoot,
    stateRoot: resolvedStateRoot,
    composePath: resolveComposeTemplatePath(),
    envPath: path.join(resolvedStateRoot, "canonical-event-store.env"),
    dataDir: path.join(resolvedStateRoot, "data"),
    backupsDir: path.join(resolvedStateRoot, "backups"),
    restoreDir: path.join(resolvedStateRoot, "restore"),
  };
}

export function ensureCanonicalEventStoreBootstrap({ repoRoot = process.cwd(), stateRoot = "", postgresPort = "55432" } = {}) {
  const paths = resolveCanonicalEventStoreBootstrapPaths({ repoRoot, stateRoot });
  mkdirSync(paths.stateRoot, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.backupsDir, { recursive: true });
  mkdirSync(paths.restoreDir, { recursive: true });
  if (!existsSync(paths.envPath)) {
    writeFileSync(paths.envPath, buildEnvText(defaultEnv({ paths, postgresPort })));
  }
  return paths;
}

export function readCanonicalEventStoreBootstrapContract({ paths } = {}) {
  const env = readBootstrapEnv(paths);
  return {
    ok: true,
    compose_path: paths.composePath,
    env_path: paths.envPath,
    state_root: paths.stateRoot,
    data_dir: paths.dataDir,
    backups_dir: paths.backupsDir,
    restore_dir: paths.restoreDir,
    project_name: env.CANONICAL_EVENT_STORE_PROJECT,
    connection_string: `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`,
  };
}

export async function checkCanonicalEventStoreHealth({ paths } = {}) {
  const env = readBootstrapEnv(paths);
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      runCommand([...composeInvocation(paths), "exec", "-T", "postgres", "pg_isready", "-h", "127.0.0.1", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB]);
      return { ok: true };
    } catch (error) {
      lastError = error;
      if (attempt < 29) await setTimeout(1000);
    }
  }
  return { ok: false, reason: String(lastError?.message || lastError) };
}

export async function runCanonicalEventStoreBackup({ paths, backupLabel = "backup" } = {}) {
  const backupPath = path.join(paths.backupsDir, `${backupLabel}.sql`);
  const env = readBootstrapEnv(paths);
  const sql = runCommand(
    [...composeInvocation(paths), "exec", "-T", "postgres", "env", `PGPASSWORD=${env.POSTGRES_PASSWORD}`, "pg_dump", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB, "--clean", "--if-exists", "--create"],
  );
  writeFileSync(backupPath, sql);
  return { ok: true, backupPath };
}

export async function runCanonicalEventStoreRestore({ paths, backupPath } = {}) {
  const env = readBootstrapEnv(paths);
  const sql = readFileSync(backupPath, "utf8");
  runCommand(
    [...composeInvocation(paths), "exec", "-T", "postgres", "env", `PGPASSWORD=${env.POSTGRES_PASSWORD}`, "psql", "-U", env.POSTGRES_USER, "-d", "postgres"],
    { input: sql },
  );
  return { ok: true, backupPath };
}

export async function shutdownCanonicalEventStoreBootstrap({ paths, removeVolumes = false } = {}) {
  runCommand([...composeInvocation(paths), "down", ...(removeVolumes ? ["--volumes"] : [])]);
  return { ok: true };
}

export async function runCanonicalEventStoreBootstrapSmoke({ paths } = {}) {
  runCommand([...composeInvocation(paths), "up", "-d", "postgres"]);
  const health = await checkCanonicalEventStoreHealth({ paths });
  if (!health.ok) {
    return { ok: false, health };
  }

  psqlExec(paths, "drop table if exists commit01_smoke; create table commit01_smoke(id integer primary key); insert into commit01_smoke(id) values (1);");
  const backup = await runCanonicalEventStoreBackup({ paths, backupLabel: "bootstrap-smoke" });
  psqlExec(paths, "drop table if exists commit01_smoke;");
  await runCanonicalEventStoreRestore({ paths, backupPath: backup.backupPath });
  const rowCount = trim(psqlExec(paths, "select count(*) from commit01_smoke;"));

  return {
    ok: rowCount === "1",
    health,
    backup,
    restored_row_count: rowCount,
  };
}
