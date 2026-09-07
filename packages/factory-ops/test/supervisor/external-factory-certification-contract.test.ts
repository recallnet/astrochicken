import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXTERNAL_FACTORY_CERTIFICATION_CONTRACT_PATH,
  SURFACE_IDS,
  loadCertificationContract,
} from "../../src/lib/external-factory-certification-contract.ts";

const EXPECTED_SURFACE_IDS = [
  "env_auth_isolation",
  "fleet_visibility",
  "host_lifecycle_same_machine",
  "incident_packet_quality",
  "model_policy_benchmark_readiness",
  "operator_onboarding_runbook_completeness",
  "pause_quarantine_retry_ergonomics",
  "policy_template_completeness",
  "release_targeting_resume_visibility",
].sort((left, right) => left.localeCompare(right, "en"));

const EXPECTED_CERTIFICATION_VERSION = 1;

// Immediate prior baseline for version-discipline checks.
// When the surface ID set changes intentionally:
// 1) copy EXPECTED_* into PREVIOUS_EXPECTED_*
// 2) update EXPECTED_SURFACE_IDS
// 3) bump EXPECTED_CERTIFICATION_VERSION
const PREVIOUS_EXPECTED_SURFACE_IDS = [
  "env_auth_isolation",
  "fleet_visibility",
  "host_lifecycle_same_machine",
  "incident_packet_quality",
  "model_policy_benchmark_readiness",
  "operator_onboarding_runbook_completeness",
  "pause_quarantine_retry_ergonomics",
  "policy_template_completeness",
  "release_targeting_resume_visibility",
].sort((left, right) => left.localeCompare(right, "en"));

const PREVIOUS_EXPECTED_CERTIFICATION_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedSurfaceIds(contract) {
  return (contract.surfaces || [])
    .map((surface) => surface.id)
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function withMutatedContract(mutator, callback) {
  const tmpPrefix = join(tmpdir(), "factory-cert-contract-");
  const tmpDir = await mkdtemp(tmpPrefix);

  try {
    const baselineRaw = await readFile(EXTERNAL_FACTORY_CERTIFICATION_CONTRACT_PATH, "utf8");
    const baselineContract = JSON.parse(baselineRaw);
    const nextContract = clone(baselineContract);

    mutator(nextContract);

    const contractPath = join(tmpDir, "external-factory-certification.json");
    await writeFile(contractPath, `${JSON.stringify(nextContract, null, 2)}\n`, "utf8");

    await callback(contractPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

test("loadCertificationContract returns validated rollout contract", async () => {
  const contract = await loadCertificationContract();

  assert.equal(Number.isInteger(contract.schema_version), true);
  assert.equal(Number.isInteger(contract.certification_version), true);
  assert.deepEqual(sortedSurfaceIds(contract), SURFACE_IDS);
  assert.equal(contract.surfaces.length, SURFACE_IDS.length);

  for (const surface of contract.surfaces) {
    assert.equal(typeof surface.id, "string");
    assert.equal(typeof surface.title, "string");
    assert.equal(typeof surface.description, "string");
    assert.equal(surface.severity, "required");
    assert.equal(Array.isArray(surface.evidence_requirements), true);
    assert.equal(surface.evidence_requirements.length > 0, true);
    assert.equal(typeof surface.failure_message, "string");
  }
});

test("loadCertificationContract fails closed on missing top-level fields", async (t) => {
  await t.test("missing schema_version", async () => {
    await withMutatedContract(
      (contract) => {
        delete contract.schema_version;
      },
      async (contractPath) => {
        await assert.rejects(
          () => loadCertificationContract({ contractPath }),
          /Missing schema_version/,
        );
      },
    );
  });

  await t.test("missing certification_version", async () => {
    await withMutatedContract(
      (contract) => {
        delete contract.certification_version;
      },
      async (contractPath) => {
        await assert.rejects(
          () => loadCertificationContract({ contractPath }),
          /Missing certification_version/,
        );
      },
    );
  });

  await t.test("missing surfaces", async () => {
    await withMutatedContract(
      (contract) => {
        delete contract.surfaces;
      },
      async (contractPath) => {
        await assert.rejects(
          () => loadCertificationContract({ contractPath }),
          /Missing surfaces/,
        );
      },
    );
  });
});

test("loadCertificationContract fails on missing required surface metadata", async () => {
  await withMutatedContract(
    (contract) => {
      delete contract.surfaces[0].failure_message;
    },
    async (contractPath) => {
      await assert.rejects(
        () => loadCertificationContract({ contractPath }),
        /Missing surface\.failure_message for id /,
      );
    },
  );
});

test("loadCertificationContract fails on duplicate surface IDs", async () => {
  await withMutatedContract(
    (contract) => {
      contract.surfaces[1].id = contract.surfaces[0].id;
    },
    async (contractPath) => {
      await assert.rejects(
        () => loadCertificationContract({ contractPath }),
        /Duplicate surface id:/,
      );
    },
  );
});

test("loadCertificationContract fails on missing required rollout surface", async () => {
  await withMutatedContract(
    (contract) => {
      contract.surfaces = contract.surfaces.filter((surface) => surface.id !== "fleet_visibility");
    },
    async (contractPath) => {
      await assert.rejects(
        () => loadCertificationContract({ contractPath }),
        /Missing required surface id: fleet_visibility/,
      );
    },
  );
});

test("surface ID drift requires certification version bump", async () => {
  const contract = await loadCertificationContract();
  const loadedIds = sortedSurfaceIds(contract);

  assert.deepEqual(loadedIds, EXPECTED_SURFACE_IDS);
  assert.deepEqual(SURFACE_IDS, EXPECTED_SURFACE_IDS);
  assert.equal(contract.certification_version, EXPECTED_CERTIFICATION_VERSION);

  const idsChangedFromPrevious = JSON.stringify(EXPECTED_SURFACE_IDS)
    !== JSON.stringify(PREVIOUS_EXPECTED_SURFACE_IDS);

  if (idsChangedFromPrevious) {
    assert.ok(
      EXPECTED_CERTIFICATION_VERSION > PREVIOUS_EXPECTED_CERTIFICATION_VERSION,
      "Surface IDs changed from the previous baseline without bumping EXPECTED_CERTIFICATION_VERSION.",
    );
    assert.ok(
      contract.certification_version > PREVIOUS_EXPECTED_CERTIFICATION_VERSION,
      "Surface IDs changed from the previous baseline without certification_version bump.",
    );
    return;
  }

  assert.equal(
    EXPECTED_CERTIFICATION_VERSION,
    PREVIOUS_EXPECTED_CERTIFICATION_VERSION,
    "When surface IDs match the previous baseline, EXPECTED_CERTIFICATION_VERSION must remain unchanged.",
  );
});
