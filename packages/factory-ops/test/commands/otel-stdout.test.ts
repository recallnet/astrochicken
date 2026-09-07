import assert from "node:assert/strict";
import test from "node:test";

import { emitOtelEvent } from "@recallnet/factory-telemetry";

test("emitOtelEvent writes OTEL_EVENT lines to stderr (not stdout)", () => {
  const prevMode = process.env.OTEL_MODE;
  process.env.OTEL_MODE = "stdout";

  let stdout = "";
  let stderr = "";
  const wOut = process.stdout.write;
  const wErr = process.stderr.write;
  process.stdout.write = ((chunk) => { stdout += String(chunk); return true; });
  process.stderr.write = ((chunk) => { stderr += String(chunk); return true; });

  try {
    emitOtelEvent({ event_name: "factory.test", body: { ok: true } });
  } finally {
    process.stdout.write = wOut;
    process.stderr.write = wErr;
    if (prevMode == null) delete process.env.OTEL_MODE;
    else process.env.OTEL_MODE = prevMode;
  }

  assert.equal(stdout, "");
  assert.match(stderr, /^OTEL_EVENT /);
  assert.match(stderr, /factory\.test/);
});
