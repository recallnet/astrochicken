import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fetchIssueBody } from "../src/commands/wave-issue-fetch-body.ts";

test("fetchIssueBody returns empty when required args are missing", () => {
  assert.equal(fetchIssueBody({ repo: "", issueNumber: "1" }), "");
  assert.equal(fetchIssueBody({ repo: "recallnet/astrochicken", issueNumber: "" }), "");
});

test("fetchIssueBody returns empty when gh command fails", () => {
  const binDir = join(tmpdir(), `ops-gh-fail-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, "#!/usr/bin/env bash\nexit 1\n", "utf8");
  chmodSync(ghPath, 0o755);

  const prevPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${prevPath}`;
  try {
    assert.equal(fetchIssueBody({ repo: "recallnet/astrochicken", issueNumber: "123" }), "");
  } finally {
    process.env.PATH = prevPath;
  }
});

test("fetchIssueBody parses JSON body and escapes template marker", () => {
  const binDir = join(tmpdir(), `ops-gh-ok-${Date.now()}`);
  mkdirSync(binDir, { recursive: true });
  const ghPath = join(binDir, "gh");
  const payload = JSON.stringify({ body: "hello ${name}" });
  writeFileSync(ghPath, `#!/usr/bin/env bash\necho '${payload}'\nexit 0\n`, "utf8");
  chmodSync(ghPath, 0o755);

  const prevPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${prevPath}`;
  try {
    assert.equal(fetchIssueBody({ repo: "recallnet/astrochicken", issueNumber: "123" }), "hello $ {name}");
  } finally {
    process.env.PATH = prevPath;
  }
});
