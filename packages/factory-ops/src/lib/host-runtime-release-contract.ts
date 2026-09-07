import { createIssueList } from "@hatch/factory-core/schema-registry";

import { trim } from "./cli-helpers.ts";
import {
  hostRuntimeReleaseManifestSchema,
  HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
} from "./host-runtime-release-schema.ts";

export { HOST_RUNTIME_RELEASE_SCHEMA_VERSION };

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateHostRuntimeReleaseManifestContract(
  manifest = {},
) {
  const reasons = [];

  if (!isObject(manifest)) {
    return {
      ok: false,
      reasons: ["manifest_not_object"],
      schema_version: HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
    };
  }

  const result = hostRuntimeReleaseManifestSchema.safeParse(manifest);
  if (!result.success) {
    const schemaIssues = createIssueList(result.error, (issue, path) => {
      if (issue.code === "invalid_value" && path === "schema_version") {
        return {
          path,
          message: `invalid_schema_version:${trim(manifest.schema_version) || "(empty)"}`,
        };
      }
      if (issue.code === "invalid_value" && path === "channel") {
        return {
          path,
          message: `invalid_channel:${trim(manifest.channel).toLowerCase() || "(empty)"}`,
        };
      }
      if (issue.code === "too_small" && path === "compatibility.supported_kinds") {
        return {
          path,
          message: "empty_compatibility.supported_kinds",
        };
      }
      if (issue.code === "too_small" && path === "compatibility.supported_platforms") {
        return {
          path,
          message: "empty_compatibility.supported_platforms",
        };
      }
      const missing = issue.input === undefined
        || issue.input === null
        || (typeof issue.input === "string" && trim(issue.input) === "");
      if (missing && path) {
        return {
          path,
          message: `missing_${path}`,
        };
      }
      return {
        path,
        message: path ? `invalid_${path}` : "invalid_manifest",
      };
    });
    reasons.push(...schemaIssues.map((entry) => entry.message));
  }

  if (trim(manifest.schema_version) !== HOST_RUNTIME_RELEASE_SCHEMA_VERSION) {
    reasons.push(`invalid_schema_version:${trim(manifest.schema_version) || "(empty)"}`);
  }

  const channel = trim(manifest.channel).toLowerCase();
  if (channel && !["stable", "canary", "pinned"].includes(channel)) {
    reasons.push(`invalid_channel:${channel}`);
  }

  const supportedKinds = manifest?.compatibility?.supported_kinds;
  if (Array.isArray(supportedKinds) && supportedKinds.length === 0) {
    reasons.push("empty_compatibility.supported_kinds");
  }

  const supportedPlatforms = manifest?.compatibility?.supported_platforms;
  if (Array.isArray(supportedPlatforms) && supportedPlatforms.length === 0) {
    reasons.push("empty_compatibility.supported_platforms");
  }

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    schema_version: HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
  };
}
