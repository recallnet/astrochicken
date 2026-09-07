import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_CONTRACT_URL = new URL("../contracts/external-factory-certification.json", import.meta.url);

export const EXTERNAL_FACTORY_CERTIFICATION_CONTRACT_PATH = fileURLToPath(DEFAULT_CONTRACT_URL);

export const SURFACE_IDS = Object.freeze([
  "env_auth_isolation",
  "fleet_visibility",
  "host_lifecycle_same_machine",
  "incident_packet_quality",
  "model_policy_benchmark_readiness",
  "operator_onboarding_runbook_completeness",
  "pause_quarantine_retry_ergonomics",
  "policy_template_completeness",
  "release_targeting_resume_visibility",
].sort((left, right) => left.localeCompare(right, "en")));

const SURFACE_ID_SET = new Set(SURFACE_IDS);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertIntegerField(payload, fieldName) {
  if (!(fieldName in payload)) {
    throw new Error(`Missing ${fieldName}`);
  }

  if (!Number.isInteger(payload[fieldName])) {
    throw new Error(`Invalid ${fieldName}: expected integer`);
  }
}

function assertNonEmptyString(value, fieldName, id = "") {
  if (typeof value !== "string" || value.trim().length === 0) {
    const suffix = id ? ` for id ${id}` : "";
    throw new Error(`Missing ${fieldName}${suffix}`);
  }
}

function assertEvidenceRequirements(value, id) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing evidence_requirements for id ${id}`);
  }

  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`Invalid evidence_requirements for id ${id}: expected non-empty strings`);
    }
  }
}

function validateSurface(surface, index, seenIds) {
  if (!isObject(surface)) {
    throw new Error(`Invalid surface at index ${index}: expected object`);
  }

  assertNonEmptyString(surface.id, "surface.id");
  const id = surface.id.trim();

  if (seenIds.has(id)) {
    throw new Error(`Duplicate surface id: ${id}`);
  }
  seenIds.add(id);

  if (!SURFACE_ID_SET.has(id)) {
    throw new Error(`Unknown surface id: ${id}`);
  }

  assertNonEmptyString(surface.title, "surface.title", id);
  assertNonEmptyString(surface.description, "surface.description", id);

  if (surface.severity !== "required") {
    throw new Error(`Invalid severity for id ${id}: expected \"required\"`);
  }

  assertEvidenceRequirements(surface.evidence_requirements, id);
  assertNonEmptyString(surface.failure_message, "surface.failure_message", id);
}

function validateSurfaceSet(surfaces) {
  if (!Array.isArray(surfaces)) {
    throw new Error("Missing surfaces");
  }

  if (surfaces.length === 0) {
    throw new Error("Missing surfaces");
  }

  const seenIds = new Set();
  surfaces.forEach((surface, index) => {
    validateSurface(surface, index, seenIds);
  });

  for (const expectedId of SURFACE_IDS) {
    if (!seenIds.has(expectedId)) {
      throw new Error(`Missing required surface id: ${expectedId}`);
    }
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid certification contract JSON: ${message}`);
  }
}

export async function loadCertificationContract({
  contractPath = EXTERNAL_FACTORY_CERTIFICATION_CONTRACT_PATH,
} = {}) {
  const raw = await readFile(contractPath, "utf8");
  const parsed = parseJson(raw);

  if (!isObject(parsed)) {
    throw new Error("Invalid certification contract: expected top-level object");
  }

  assertIntegerField(parsed, "schema_version");
  assertIntegerField(parsed, "certification_version");
  validateSurfaceSet(parsed.surfaces);

  return parsed;
}
