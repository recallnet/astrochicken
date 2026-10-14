import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export function createComposeCommand({ repoRoot, composePath, project, envPath, spawn = spawnSync }) {
  return (...args) => {
    const result = spawn("docker", ["compose", "-p", project, "-f", composePath, "--env-file", envPath, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env },
    });
    if (result.error || result.status !== 0) {
      throw new Error(`fixture_compose_failed status=${result.status}: ${result.error?.message || result.stderr || result.stdout || "no process output"}`);
    }
    return String(result.stdout || "");
  };
}

export async function waitForComposePostgres(compose, user, database) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      // The initialization-only Unix socket can stop before normal startup.
      compose("exec", "-T", "postgres", "pg_isready", "-h", "127.0.0.1", "-U", user, "-d", database);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 29) await setTimeout(1000);
    }
  }
  throw new Error(`fixture_postgres_not_ready: ${lastError?.message}`);
}
