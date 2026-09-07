import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { validateFactoryPublicContractDrift } from "./check-factory-public-contract.ts"

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const checkerPath = join(scriptsDir, "check-factory-public-contract.mjs")
const fixturesRoot = join(scriptsDir, "test", "fixtures", "factory-public-contract")

function fixtureRoot(name) {
  return join(fixturesRoot, name)
}

test("validateFactoryPublicContractDrift accepts aligned fixture", () => {
  const result = validateFactoryPublicContractDrift({ repoRoot: fixtureRoot("valid") })

  assert.equal(result.ok, true)
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.telemetry, "[factory-public-contract] result=ok checked_files=3")
})

test("validateFactoryPublicContractDrift fails when template misses required contract key", () => {
  const result = validateFactoryPublicContractDrift({ repoRoot: fixtureRoot("invalid-missing-required-key") })

  assert.equal(result.ok, false)
  assert.equal(
    result.diagnostics.some((line) => line.includes("file=") && line.includes("factory.config.json.template") && line.includes("field=trust.roles")),
    true,
  )
  assert.match(result.telemetry, /^\[factory-public-contract\] result=fail diagnostics=\d+$/)
})

test("validateFactoryPublicContractDrift fails when unmanaged template leaks forbidden managed-only key", () => {
  const result = validateFactoryPublicContractDrift({ repoRoot: fixtureRoot("invalid-unexpected-managed-only-key") })

  assert.equal(result.ok, false)
  assert.equal(
    result.diagnostics.some((line) => line.includes("factory.config.json.template") && line.includes("field=managed") && line.includes("managed-only")),
    true,
  )
})

test("validateFactoryPublicContractDrift fails when onboarding doc omits canonical links", () => {
  const result = validateFactoryPublicContractDrift({ repoRoot: fixtureRoot("invalid-missing-onboarding-link") })

  assert.equal(result.ok, false)
  assert.equal(
    result.diagnostics.some((line) => line.includes("external-factory-operator-onboarding.md") && line.includes("field=link:../reference/factory-public-contract.md")),
    true,
  )
  assert.equal(
    result.diagnostics.some((line) => line.includes("external-factory-operator-onboarding.md") && line.includes("field=link:../contracts/factory-public-contract.v1.json")),
    true,
  )
  assert.equal(
    result.diagnostics.some((line) => line.includes("external-factory-operator-onboarding.md") && line.includes("field=link:../reference/factory-mode-applicability.md")),
    true,
  )
})

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync("node", [checkerPath, "--repo-root", fixtureRoot("valid")], {
    encoding: "utf8",
  })

  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), "[factory-public-contract] result=ok checked_files=3")
  assert.equal(run.stderr.trim(), "")
})

test("CLI prints deterministic diagnostics on drift", () => {
  const run = spawnSync("node", [checkerPath, "--repo-root", fixtureRoot("invalid-unexpected-managed-only-key")], {
    encoding: "utf8",
  })

  assert.equal(run.status, 1)
  assert.match(run.stderr, /file=.*factory\.config\.json\.template field=managed message=managed-only field is not allowed in standalone template/)
  assert.match(run.stderr, /^\[factory-public-contract\] result=fail diagnostics=\d+\n?$/m)
})
