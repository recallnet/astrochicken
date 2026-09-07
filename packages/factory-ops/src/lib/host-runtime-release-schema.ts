import { artifactTrustBundleSchema } from "@hatch/factory-core/artifact-trust-registry";
import { defineBoundarySchema, z } from "@hatch/factory-core/schema-registry";

export const HOST_RUNTIME_RELEASE_SCHEMA_VERSION = "host_runtime_release/v1";

const nonEmptyStringSchema = z.string().trim().min(1);

export const hostRuntimeReleaseManifestSchema = z.strictObject({
  schema_version: z.literal(HOST_RUNTIME_RELEASE_SCHEMA_VERSION),
  version: nonEmptyStringSchema,
  channel: z.enum(["stable", "canary", "pinned"]),
  provenance: z.strictObject({
    git_sha: nonEmptyStringSchema,
    build_timestamp: z.iso.datetime(),
    source_ref: z.string().optional(),
  }),
  compatibility: z.strictObject({
    supported_kinds: z.array(nonEmptyStringSchema).min(1),
    supported_platforms: z.array(nonEmptyStringSchema).min(1),
    min_factory_ops_version: z.string().optional(),
    max_factory_ops_version: z.string().optional(),
  }),
  artifactRef: z.strictObject({
    url: nonEmptyStringSchema,
    checksum_sha256: z.string().optional(),
    size_bytes: z.number().int().min(0).optional(),
    asset_id: z.string().optional(),
    asset_path: z.string().optional(),
  }),
  trust: artifactTrustBundleSchema,
  metadata: z.strictObject({
    timestamp: z.iso.datetime(),
    release_id: z.string().optional(),
    release_tag: z.string().optional(),
    release_sha: z.string().optional(),
  }),
});

export const HOST_RUNTIME_RELEASE_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: "https://recallnet.dev/contracts/host-runtime-release.json",
  version: HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
  title: "Host Runtime Release Manifest",
  description: "Versioned host-runtime release artifact contract consumed by hatch-host and managed factory kinds.",
  schema: hostRuntimeReleaseManifestSchema,
  sourcePath: "packages/factory-ops/src/lib/host-runtime-release-schema.ts",
  outputPath: "docs/contracts/host-runtime-release.json",
});
