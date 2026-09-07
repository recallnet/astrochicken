import { defineBoundarySchema, z } from "@hatch/factory-core/schema-registry";

import { trim } from "./cli-helpers.ts";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ROLLOUT_CHANNELS = ["stable", "canary", "pinned"];

function formatAllowedChannels() {
  return `[${ROLLOUT_CHANNELS.map((channel) => `'${channel}'`).join(",")}]`;
}

export const RESUME_POLICY_SCHEMA = {
  top_level_keys: [
    "control_plane_repo",
    "controlPlaneRepo",
    "rollout",
    "pins",
    "factory_releases",
    "manifest_path",
    "manifest_ref",
    "manifest_fetch_command",
    "local_factory_release_command",
    "self_update_command",
    "localReleaseCmdByFactory",
    "policy_validation_errors",
  ],
  rollout_keys: [
    "default_channel",
    "repo_channels",
    "milestone_channels",
    "repo_milestone_channels",
    "channels",
  ],
  rollout_channel_keys: [
    "manifest_path",
    "manifest_ref",
    "manifest_fetch_command",
  ],
  pin_keys: [
    "repos",
    "milestones",
    "repo_milestones",
    "by_factory",
  ],
  factory_release_keys: [
    "by_factory",
    "repo_milestones",
    "milestones",
    "repos",
    "default_release",
  ],
  rollout_channels: [...ROLLOUT_CHANNELS],
};

const nonEmptyStringSchema = z.string().trim().min(1);
const stringMapSchema = z.record(z.string(), nonEmptyStringSchema);
const rolloutChannelSchema = z.object({
  manifest_path: nonEmptyStringSchema.optional(),
  manifest_ref: nonEmptyStringSchema.optional(),
  manifest_fetch_command: nonEmptyStringSchema.optional(),
}).strict();

const resumePolicySchema = z.object({
  control_plane_repo: nonEmptyStringSchema.optional(),
  controlPlaneRepo: nonEmptyStringSchema.optional(),
  rollout: z.object({
    default_channel: nonEmptyStringSchema.optional(),
    repo_channels: stringMapSchema.optional(),
    milestone_channels: stringMapSchema.optional(),
    repo_milestone_channels: stringMapSchema.optional(),
    channels: z.record(z.string(), rolloutChannelSchema).optional(),
  }).strict().optional(),
  pins: z.object({
    repos: stringMapSchema.optional(),
    milestones: stringMapSchema.optional(),
    repo_milestones: stringMapSchema.optional(),
    by_factory: stringMapSchema.optional(),
  }).strict().optional(),
  factory_releases: z.object({
    by_factory: stringMapSchema.optional(),
    repo_milestones: stringMapSchema.optional(),
    milestones: stringMapSchema.optional(),
    repos: stringMapSchema.optional(),
    default_release: nonEmptyStringSchema.optional(),
  }).strict().optional(),
  manifest_path: nonEmptyStringSchema.optional(),
  manifest_ref: nonEmptyStringSchema.optional(),
  manifest_fetch_command: nonEmptyStringSchema.optional(),
  local_factory_release_command: nonEmptyStringSchema.optional(),
  self_update_command: nonEmptyStringSchema.optional(),
  localReleaseCmdByFactory: stringMapSchema.optional(),
  policy_validation_errors: z.array(z.string()).optional(),
}).strict();

export const RESUME_POLICY_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: "https://recallnet.dev/contracts/release-resume-policy.json",
  version: "release_resume_policy/v1",
  title: "Release Resume Policy",
  description: "Versioned release resume policy contract for hatch-ops release control-plane workflows.",
  schema: resumePolicySchema,
  sourcePath: "packages/factory-ops/src/lib/resume-policy-schema.ts",
  outputPath: "docs/contracts/release-resume-policy.json",
});

function validateStringField({ policy = {}, key = "", errors = [], required = false } = {}) {
  const value = policy[key];
  if (value === undefined || value === null || trim(value) === "") {
    if (required) errors.push(`${key} is required`);
    return;
  }
  if (typeof value !== "string") {
    errors.push(`${key} must be a non-empty string`);
  }
}

function validateStringMap({ value = {}, path = "", errors = [], allowedValues = null } = {}) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object map`);
    return;
  }

  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const allowedSet = Array.isArray(allowedValues) ? new Set(allowedValues) : null;

  for (const key of keys) {
    const normalizedKey = trim(key);
    if (!normalizedKey) {
      errors.push(`${path} contains an empty key`);
      continue;
    }

    const raw = value[key];
    const normalizedValue = trim(raw);
    if (typeof raw !== "string" || !normalizedValue) {
      errors.push(`${path}.${normalizedKey} must be a non-empty string`);
      continue;
    }

    if (allowedSet && !allowedSet.has(normalizedValue)) {
      errors.push(`${path}.${normalizedKey} must be one of ${formatAllowedChannels()}`);
    }
  }
}

export function validateResumePolicy(policy) {
  const errors = [];

  if (!isObject(policy)) {
    return {
      ok: false,
      errors: ["policy must be a JSON object"],
    };
  }

  const parsed = resumePolicySchema.safeParse(policy);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        const prefix = issue.path.length === 0 ? "Unknown top-level key" : "Unknown key";
        for (const key of issue.keys) {
          errors.push(`${prefix} \`${key}\``);
        }
        continue;
      }

      const path = issue.path.join(".");
      if (path) {
        errors.push(`${path} must be a non-empty string`);
      }
    }
  }

  const hasControlPlaneRepo = Boolean(trim(policy.control_plane_repo || policy.controlPlaneRepo));
  if (!hasControlPlaneRepo) {
    errors.push("control_plane_repo is required");
  }

  validateStringField({ policy, key: "manifest_path", errors });
  validateStringField({ policy, key: "manifest_ref", errors });
  validateStringField({ policy, key: "manifest_fetch_command", errors });
  validateStringField({ policy, key: "local_factory_release_command", errors });
  validateStringField({ policy, key: "self_update_command", errors });

  if (policy.rollout !== undefined) {
    if (!isObject(policy.rollout)) {
      errors.push("rollout must be an object");
    } else {
      const rollout = policy.rollout;
      const defaultChannel = trim(rollout.default_channel);
      if (defaultChannel && !ROLLOUT_CHANNELS.includes(defaultChannel)) {
        errors.push(`rollout.default_channel must be one of ${formatAllowedChannels()}`);
      }

      if (rollout.repo_channels !== undefined) {
        validateStringMap({
          value: rollout.repo_channels,
          path: "rollout.repo_channels",
          errors,
          allowedValues: ROLLOUT_CHANNELS,
        });
      }

      if (rollout.milestone_channels !== undefined) {
        validateStringMap({
          value: rollout.milestone_channels,
          path: "rollout.milestone_channels",
          errors,
          allowedValues: ROLLOUT_CHANNELS,
        });
      }

      if (rollout.repo_milestone_channels !== undefined) {
        validateStringMap({
          value: rollout.repo_milestone_channels,
          path: "rollout.repo_milestone_channels",
          errors,
          allowedValues: ROLLOUT_CHANNELS,
        });
      }

      if (rollout.channels !== undefined) {
        if (!isObject(rollout.channels)) {
          errors.push("rollout.channels must be an object map");
        } else {
          const channelNames = Object.keys(rollout.channels).sort((left, right) => left.localeCompare(right));
          for (const channelName of channelNames) {
            const normalizedChannelName = trim(channelName);
            if (!ROLLOUT_CHANNELS.includes(normalizedChannelName)) {
              errors.push(`rollout.channels.${normalizedChannelName} must be one of ${formatAllowedChannels()}`);
              continue;
            }

            const channelConfig = rollout.channels[channelName];
            if (!isObject(channelConfig)) {
              errors.push(`rollout.channels.${normalizedChannelName} must be an object`);
              continue;
            }
            validateStringField({ policy: channelConfig, key: "manifest_path", errors });
            validateStringField({ policy: channelConfig, key: "manifest_ref", errors });
            validateStringField({ policy: channelConfig, key: "manifest_fetch_command", errors });
          }
        }
      }
    }
  }

  if (policy.pins !== undefined) {
    if (!isObject(policy.pins)) {
      errors.push("pins must be an object");
    } else {
      const pins = policy.pins;
      if (pins.repos !== undefined) validateStringMap({ value: pins.repos, path: "pins.repos", errors });
      if (pins.milestones !== undefined) validateStringMap({ value: pins.milestones, path: "pins.milestones", errors });
      if (pins.by_factory !== undefined) validateStringMap({ value: pins.by_factory, path: "pins.by_factory", errors });
      if (pins.repo_milestones !== undefined) validateStringMap({ value: pins.repo_milestones, path: "pins.repo_milestones", errors });
    }
  }

  if (policy.factory_releases !== undefined) {
    if (!isObject(policy.factory_releases)) {
      errors.push("factory_releases must be an object");
    } else {
      const factoryReleases = policy.factory_releases;
      if (factoryReleases.by_factory !== undefined) validateStringMap({ value: factoryReleases.by_factory, path: "factory_releases.by_factory", errors });
      if (factoryReleases.repo_milestones !== undefined) validateStringMap({ value: factoryReleases.repo_milestones, path: "factory_releases.repo_milestones", errors });
      if (factoryReleases.milestones !== undefined) validateStringMap({ value: factoryReleases.milestones, path: "factory_releases.milestones", errors });
      if (factoryReleases.repos !== undefined) validateStringMap({ value: factoryReleases.repos, path: "factory_releases.repos", errors });
      if (factoryReleases.default_release !== undefined) {
        if (typeof factoryReleases.default_release !== "string" || !trim(factoryReleases.default_release)) {
          errors.push("factory_releases.default_release must be a non-empty string");
        }
      }
    }
  }

  if (policy.localReleaseCmdByFactory !== undefined) {
    validateStringMap({
      value: policy.localReleaseCmdByFactory,
      path: "localReleaseCmdByFactory",
      errors,
    });
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
  };
}
