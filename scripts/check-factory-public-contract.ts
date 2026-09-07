#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const TELEMETRY_PREFIX = "factory-public-contract"
const DEFAULT_SCHEMA_PATH = "docs/contracts/factory-public-contract.v1.json"
const DEFAULT_TEMPLATE_PATH = "factories/_templates/factory/factory.config.json.template"
const DEFAULT_ONBOARDING_DOCS = Object.freeze([
  "docs/runbooks/external-factory-operator-onboarding.md",
])
const DEFAULT_ONBOARDING_LINKS = Object.freeze([
  "../reference/factory-public-contract.md",
  "../contracts/factory-public-contract.v1.json",
  "../reference/factory-mode-applicability.md",
])
const DEFAULT_ALLOWED_TEMPLATE_MANAGED_ONLY = Object.freeze([
  "instance_id",
  "canonical_checkout_path",
])

function trim(value = "") {
  return String(value ?? "").trim()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function toPathSegments(fieldPath) {
  return String(fieldPath)
    .split(".")
    .map((segment) => trim(segment))
    .filter(Boolean)
}

function hasFieldPath(value, fieldPath) {
  const segments = toPathSegments(fieldPath)
  if (segments.length === 0) {
    return false
  }

  let cursor = value
  for (const segment of segments) {
    if (!isPlainObject(cursor) || !(segment in cursor)) {
      return false
    }
    cursor = cursor[segment]
  }

  return true
}

function relativeOrAbsolutePath(pathValue) {
  return trim(pathValue)
}

function pushDiagnostic(diagnostics, { file, field, message }) {
  diagnostics.push(`file=${relativeOrAbsolutePath(file)} field=${field} message=${message}`)
}

function readConfigSection(contract, diagnostics, schemaPath) {
  if (!isPlainObject(contract)) {
    pushDiagnostic(diagnostics, {
      file: schemaPath,
      field: "schema",
      message: "contract document must be an object",
    })
    return null
  }

  const sections = Array.isArray(contract.sections) ? contract.sections : []
  const configSection = sections.find((section) => isPlainObject(section) && section.name === "config")
  if (!configSection) {
    pushDiagnostic(diagnostics, {
      file: schemaPath,
      field: "sections.config",
      message: "missing config section",
    })
    return null
  }

  return configSection
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => trim(entry))
    .filter(Boolean)
}

function ensureRequiredTemplateFields({ templateDoc, templatePath, requiredFields, diagnostics }) {
  for (const field of requiredFields) {
    if (hasFieldPath(templateDoc, field)) {
      continue
    }
    pushDiagnostic(diagnostics, {
      file: templatePath,
      field,
      message: "required field missing from template",
    })
  }
}

function ensureManagedOnlyTemplateAllowance({
  schemaPath,
  templateDoc,
  templatePath,
  managedOnlyFields,
  allowedTemplateManagedOnly,
  diagnostics,
}) {
  const managedOnlySet = new Set(managedOnlyFields)
  const allowlistSet = new Set(allowedTemplateManagedOnly)

  for (const field of allowlistSet) {
    if (managedOnlySet.has(field)) {
      continue
    }
    pushDiagnostic(diagnostics, {
      file: schemaPath,
      field: `drift_gate.allowed_template_managed_only.${field}`,
      message: "allowlist entry must be listed in config.managed_only",
    })
  }

  for (const field of managedOnlyFields) {
    if (!hasFieldPath(templateDoc, field)) {
      continue
    }
    if (allowlistSet.has(field)) {
      continue
    }

    pushDiagnostic(diagnostics, {
      file: templatePath,
      field,
      message: "managed-only field is not allowed in standalone template",
    })
  }
}

function renderOnboardingLinkBlock(requiredLinks) {
  const hasContractDoc = requiredLinks.includes("../reference/factory-public-contract.md")
  const hasSchema = requiredLinks.includes("../contracts/factory-public-contract.v1.json")
  const hasModeReference = requiredLinks.includes("../reference/factory-mode-applicability.md")

  const lines = [
    "",
    "Factory boundary contract (required reading before bootstrap):",
  ]

  if (hasContractDoc) {
    lines.push("- [Factory Public Contract (v1)](../reference/factory-public-contract.md)")
  }

  if (hasSchema) {
    lines.push("- Machine-readable form: [`docs/contracts/factory-public-contract.v1.json`](../contracts/factory-public-contract.v1.json)")
  }

  if (hasModeReference) {
    lines.push("- Mode matrix reference: [Factory Mode Applicability (v1)](../reference/factory-mode-applicability.md)")
  }

  for (const link of requiredLinks) {
    if (hasContractDoc && link === "../reference/factory-public-contract.md") {
      continue
    }
    if (hasSchema && link === "../contracts/factory-public-contract.v1.json") {
      continue
    }
    if (hasModeReference && link === "../reference/factory-mode-applicability.md") {
      continue
    }
    lines.push(`- Contract link: ${link}`)
  }

  return `${lines.join("\n")}\n`
}

function ensureOnboardingLinks({
  onboardingDocs,
  requiredLinks,
  diagnostics,
  write,
}) {
  for (const onboardingDoc of onboardingDocs) {
    let content
    try {
      content = readFileSync(onboardingDoc, "utf8")
    } catch (error) {
      pushDiagnostic(diagnostics, {
        file: onboardingDoc,
        field: "file",
        message: `unable to read onboarding doc (${String(error?.message || error)})`,
      })
      continue
    }

    const missingLinks = requiredLinks.filter((link) => !content.includes(link))
    if (missingLinks.length === 0) {
      continue
    }

    if (write) {
      const nextContent = `${content.replace(/\s*$/, "\n")}${renderOnboardingLinkBlock(missingLinks)}`
      writeFileSync(onboardingDoc, nextContent)
      continue
    }

    for (const missingLink of missingLinks) {
      pushDiagnostic(diagnostics, {
        file: onboardingDoc,
        field: `link:${missingLink}`,
        message: "required public-contract link missing",
      })
    }
  }
}

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    schemaPath: null,
    templatePath: null,
    onboardingDocs: [],
    write: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--repo-root") {
      const value = argv[index + 1]
      if (!value) {
        throw new Error("--repo-root requires a path")
      }
      options.repoRoot = resolve(value)
      index += 1
      continue
    }

    if (arg === "--schema") {
      const value = argv[index + 1]
      if (!value) {
        throw new Error("--schema requires a path")
      }
      options.schemaPath = resolve(options.repoRoot, value)
      index += 1
      continue
    }

    if (arg === "--template") {
      const value = argv[index + 1]
      if (!value) {
        throw new Error("--template requires a path")
      }
      options.templatePath = resolve(options.repoRoot, value)
      index += 1
      continue
    }

    if (arg === "--onboarding-doc") {
      const value = argv[index + 1]
      if (!value) {
        throw new Error("--onboarding-doc requires a path")
      }
      options.onboardingDocs.push(resolve(options.repoRoot, value))
      index += 1
      continue
    }

    if (arg === "--write" || arg === "--fix") {
      options.write = true
      continue
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function usage() {
  return [
    "Usage:",
    "  node scripts/check-factory-public-contract.ts [--repo-root <path>] [--schema <path>] [--template <path>] [--onboarding-doc <path>] [--write|--fix]",
  ].join("\n")
}

export function validateFactoryPublicContractDrift({
  repoRoot = process.cwd(),
  schemaPath,
  templatePath,
  onboardingDocs,
  write = false,
} = {}) {
  const diagnostics = []

  const resolvedSchemaPath = resolve(repoRoot, schemaPath || DEFAULT_SCHEMA_PATH)
  const resolvedTemplatePath = resolve(repoRoot, templatePath || DEFAULT_TEMPLATE_PATH)

  let contract
  try {
    contract = readJson(resolvedSchemaPath)
  } catch (error) {
    pushDiagnostic(diagnostics, {
      file: resolvedSchemaPath,
      field: "schema",
      message: `unable to parse contract schema (${String(error?.message || error)})`,
    })
    return {
      ok: false,
      diagnostics,
      telemetry: `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnostics.length}`,
    }
  }

  const configSection = readConfigSection(contract, diagnostics, resolvedSchemaPath)

  let templateDoc = null
  try {
    templateDoc = readJson(resolvedTemplatePath)
  } catch (error) {
    pushDiagnostic(diagnostics, {
      file: resolvedTemplatePath,
      field: "template",
      message: `unable to parse template (${String(error?.message || error)})`,
    })
  }

  if (configSection && templateDoc) {
    const requiredFields = normalizeStringArray(configSection.required)
    const managedOnlyFields = normalizeStringArray(configSection.managed_only)

    const driftGate = isPlainObject(contract.drift_gate) ? contract.drift_gate : {}
    const configDriftGate = isPlainObject(configSection.drift_gate) ? configSection.drift_gate : {}

    const allowedTemplateManagedOnly = normalizeStringArray(
      configDriftGate.allowed_template_managed_only
      || driftGate.allowed_template_managed_only
      || DEFAULT_ALLOWED_TEMPLATE_MANAGED_ONLY,
    )

    ensureRequiredTemplateFields({
      templateDoc,
      templatePath: resolvedTemplatePath,
      requiredFields,
      diagnostics,
    })

    ensureManagedOnlyTemplateAllowance({
      schemaPath: resolvedSchemaPath,
      templateDoc,
      templatePath: resolvedTemplatePath,
      managedOnlyFields,
      allowedTemplateManagedOnly,
      diagnostics,
    })
  }

  const driftGate = isPlainObject(contract.drift_gate) ? contract.drift_gate : {}
  const requiredLinks = normalizeStringArray(driftGate.required_onboarding_links)
  const configuredOnboardingDocs = normalizeStringArray(driftGate.onboarding_docs)

  const resolvedOnboardingDocs = (Array.isArray(onboardingDocs) && onboardingDocs.length > 0)
    ? onboardingDocs.map((pathValue) => resolve(repoRoot, pathValue))
    : (configuredOnboardingDocs.length > 0
      ? configuredOnboardingDocs.map((pathValue) => resolve(repoRoot, pathValue))
      : DEFAULT_ONBOARDING_DOCS.map((pathValue) => resolve(repoRoot, pathValue)))

  ensureOnboardingLinks({
    onboardingDocs: resolvedOnboardingDocs,
    requiredLinks: requiredLinks.length > 0 ? requiredLinks : [...DEFAULT_ONBOARDING_LINKS],
    diagnostics,
    write,
  })

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"))
  const ok = sortedDiagnostics.length === 0

  return {
    ok,
    diagnostics: sortedDiagnostics,
    telemetry: ok
      ? `[${TELEMETRY_PREFIX}] result=ok checked_files=${2 + resolvedOnboardingDocs.length}`
      : `[${TELEMETRY_PREFIX}] result=fail diagnostics=${sortedDiagnostics.length}`,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const result = validateFactoryPublicContractDrift({
    repoRoot: options.repoRoot,
    schemaPath: options.schemaPath,
    templatePath: options.templatePath,
    onboardingDocs: options.onboardingDocs,
    write: options.write,
  })

  if (result.ok) {
    process.stdout.write(`${result.telemetry}\n`)
    return
  }

  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic}\n`)
  }
  process.stderr.write(`${result.telemetry}\n`)
  process.exitCode = 1
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`)
    process.stderr.write(`[${TELEMETRY_PREFIX}] result=fail diagnostics=1\n`)
    process.exit(1)
  })
}
