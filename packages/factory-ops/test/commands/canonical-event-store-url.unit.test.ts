import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveCanonicalEventStoreUrl } from "../../src/lib/canonical-event-store-url.ts";

test("resolveCanonicalEventStoreUrl materializes the local bootstrap contract when env is absent", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-event-store-url-"));
  const previousCwd = process.cwd();
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;

  try {
    delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    process.chdir(repoRoot);

    const connectionString = resolveCanonicalEventStoreUrl({
      runsDir: path.join(repoRoot, ".hatch", "mothership", "runs"),
      context: { factory_id: "mothership" },
      surface: "unit test",
    });

    assert.equal(
      connectionString,
      "postgres://astrochicken:astrochicken@127.0.0.1:55432/astrochicken_factory",
    );
  } finally {
    process.chdir(previousCwd);
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("resolveCanonicalEventStoreUrl honors explicit repo roots when the caller cwd is package-local", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "canonical-event-store-url-repo-root-"));
  const packageLocalCwd = path.join(repoRoot, "packages", "factory-ops");
  const previousCwd = process.cwd();
  const previousUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;

  try {
    delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    mkdirSync(packageLocalCwd, { recursive: true });
    process.chdir(packageLocalCwd);

    const connectionString = resolveCanonicalEventStoreUrl({
      runsDir: path.join(repoRoot, ".hatch", "mothership", "runs"),
      context: {
        factory_id: "mothership",
        repo: repoRoot,
      },
      surface: "unit test",
    });

    assert.equal(
      connectionString,
      "postgres://astrochicken:astrochicken@127.0.0.1:55432/astrochicken_factory",
    );
  } finally {
    process.chdir(previousCwd);
    if (previousUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
    else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousUrl;
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
