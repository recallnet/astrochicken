import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tclQuote(value = "") {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\$/g, "\\$")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

export function runExpectScenario({
  cwd,
  env = {},
  command = [],
  steps = [],
  timeoutSeconds = 5,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "tui-expect-"));
  const scriptPath = join(root, "scenario.expect");
  const logPath = join(root, "transcript.log");

  const script = [
    "#!/usr/bin/expect -f",
    `set timeout ${Number(timeoutSeconds) || 5}`,
    `log_file -noappend ${tclQuote(logPath)}`,
    `spawn -noecho {*}[list ${command.map((entry) => tclQuote(entry)).join(" ")}]`,
    ...steps.flatMap((step) => {
      const lines = [];
      if (step.expect) {
        lines.push(`expect ${tclQuote(step.expect)}`);
      }
      if (step.send) {
        lines.push(`send -- ${tclQuote(step.send)}`);
      }
      if (step.afterMs) {
        lines.push(`after ${Number(step.afterMs) || 25}`);
      }
      return lines;
    }),
    "expect eof",
  ].join("\n");

  writeFileSync(scriptPath, script);

  const run = spawnSync("expect", ["-f", scriptPath], {
    cwd,
    env: {
      ...process.env,
      // PTY scenarios model interactive terminals. Ink buffers intermediate
      // frames in CI mode, which prevents expect from exercising live input.
      CI: "false",
      TERM: "xterm-256color",
      FORCE_COLOR: "0",
      ...env,
    },
    encoding: "utf8",
  });

  const transcript = readFileSync(logPath, "utf8");
  assert.equal(run.status, 0, `${run.stderr || run.stdout}\n${transcript}`);
  return { ...run, transcript };
}
