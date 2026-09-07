import { spawnSync } from "node:child_process";
import path from "node:path";

import { parseJson, trim } from "./cli-helpers.ts";

export function runRuntimeStartupProbe({
  repoRoot = "",
  daemonLogPath = "",
  appendCommandOutputToLogFn = () => {},
} = {}) {
  const probeScriptPath = path.resolve(repoRoot, "scripts/check-runtime-startup-probe.ts");
  const run = spawnSync(process.execPath, [probeScriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const parsed = parseJson(String(run.stdout || ""), {
    result: "fail",
    probes: [],
  }) as {
    result?: string;
    probes?: unknown[];
  };
  const ok = run.status === 0 && parsed?.result === "ok";
  if (!ok && daemonLogPath) {
    appendCommandOutputToLogFn(daemonLogPath, run.stdout || "");
    appendCommandOutputToLogFn(daemonLogPath, run.stderr || "");
  }
  return {
    ok,
    result: ok ? "ok" : "fail",
    probes: Array.isArray(parsed?.probes) ? parsed.probes : [],
    detail: ok ? "" : trim(run.stderr || run.stdout || "runtime_startup_probe_failed"),
  };
}
