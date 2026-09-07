import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(normalize(value), null, 2);
}

function listTickFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("tick-") && name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
}

function nextTickSequence(dir) {
  const entries = listTickFiles(dir);
  let max = 0;
  for (const entry of entries) {
    const m = entry.match(/^tick-(\d+)\.json$/);
    if (!m) continue;
    const num = Number(m[1]);
    if (Number.isFinite(num)) max = Math.max(max, num);
  }
  return String(max + 1).padStart(6, "0");
}

export function writeTickArtifact({ runId, runsDir = ".hatch/runs", tick }) {
  if (!runId) return "";
  const dir = join(runsDir, runId, "ticks");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const seq = nextTickSequence(dir);
  const filename = `tick-${seq}.json`;
  const path = join(dir, filename);
  const serialized = stableStringify(tick);
  writeFileSync(path, `${serialized}\n`);
  return path;
}
