import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ForemanCycleArtifact } from "./types.js";

export interface ForemanTelemetryDeps {
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  readFile?: typeof readFile;
  readdir?: typeof readdir;
}

export interface ReadForemanHistoryOptions {
  since?: string;
  limit?: number;
}

function foremanDir(runsDir: string) {
  return join(runsDir, "foreman");
}

function artifactPath(runsDir: string, artifact: ForemanCycleArtifact) {
  const stamp = artifact.timestamp.replaceAll(":", "-");
  return join(foremanDir(runsDir), `${stamp}-${artifact.cycle_id}.json`);
}

export async function writeForemanArtifact(
  runsDir: string,
  artifact: ForemanCycleArtifact,
  deps: ForemanTelemetryDeps = {},
) {
  const mkdirFn = deps.mkdir ?? mkdir;
  const writeFileFn = deps.writeFile ?? writeFile;
  await mkdirFn(foremanDir(runsDir), { recursive: true });
  const targetPath = artifactPath(runsDir, artifact);
  await writeFileFn(targetPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return targetPath;
}

export async function readForemanHistory(
  runsDir: string,
  options: ReadForemanHistoryOptions = {},
  deps: ForemanTelemetryDeps = {},
) {
  const readdirFn = deps.readdir ?? readdir;
  const readFileFn = deps.readFile ?? readFile;
  const sinceValue = options.since ? new Date(options.since).getTime() : 0;
  const limitValue = Math.max(1, options.limit ?? 50);
  const dir = foremanDir(runsDir);
  const names = await readdirFn(dir).catch(() => []);
  const artifacts: ForemanCycleArtifact[] = [];

  for (const name of names.filter((entry) => entry.endsWith(".json")).sort().reverse()) {
    const raw = await readFileFn(join(dir, name), "utf8");
    const parsed = JSON.parse(String(raw)) as ForemanCycleArtifact;
    if (sinceValue > 0 && new Date(parsed.timestamp).getTime() < sinceValue) continue;
    artifacts.push(parsed);
    if (artifacts.length >= limitValue) break;
  }

  return artifacts;
}
