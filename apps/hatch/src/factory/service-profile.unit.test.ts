import { describe, expect, it } from "vitest";

import {
	SERVICE_PROFILE_KEYS,
	defaultServiceProfile,
	normalizeServiceProfile,
	validateServiceProfileFields,
} from "./service-profile.js";

describe("service profile schema helpers", () => {
	it("exports the canonical service profile keys", () => {
		expect(SERVICE_PROFILE_KEYS).toEqual([
			"service_tier",
			"scheduler_weight",
			"reserved_capacity",
			"upgrade_channel",
			"allowed_runtime_version",
			"support_owner",
			"feature_flags",
		]);
	});

	it("normalizes defaults with deterministic key ordering", () => {
		expect(normalizeServiceProfile()).toEqual(defaultServiceProfile);

		const normalized = normalizeServiceProfile({
			scheduler_weight: 3,
			feature_flags: {
				zeta: "on",
				alpha: "off",
			},
		});
		expect(normalized).toEqual({
			service_tier: "standard",
			scheduler_weight: 3,
			reserved_capacity: 0,
			upgrade_channel: "stable",
			allowed_runtime_version: "*",
			support_owner: "ops",
			feature_flags: {
				alpha: "off",
				zeta: "on",
			},
		});
		expect(Object.keys(normalized)).toEqual(SERVICE_PROFILE_KEYS);
		expect(Object.keys(normalized.feature_flags)).toEqual(["alpha", "zeta"]);
	});

	it("validates allowed service profile values", () => {
		const issues: Array<{ path: string; message: string }> = [];
		validateServiceProfileFields(
			{
				service_tier: "gold",
				scheduler_weight: 3,
				reserved_capacity: 1,
				upgrade_channel: "stable",
				allowed_runtime_version: ">=1.0.0 <2.0.0",
				support_owner: "factory-platform",
				feature_flags: {
					wave_autoretry: "enabled",
				},
			},
			issues,
			"instances[0]",
		);
		expect(issues).toEqual([]);
	});

	it("rejects invalid service profile values", () => {
		const issues: Array<{ path: string; message: string }> = [];
		validateServiceProfileFields(
			{
				service_tier: "gold!",
				scheduler_weight: 0,
				reserved_capacity: -1,
				upgrade_channel: "stable/channel",
				allowed_runtime_version: "v(one)",
				support_owner: "",
				feature_flags: {
					wave_autoretry: "",
				},
			},
			issues,
			"instances[0]",
		);

		expect(issues).toContainEqual({ path: "instances[0].service_tier", message: "must match /^[A-Za-z0-9-]+$/" });
		expect(issues).toContainEqual({ path: "instances[0].scheduler_weight", message: "must be an integer >= 1" });
		expect(issues).toContainEqual({ path: "instances[0].reserved_capacity", message: "must be an integer >= 0" });
		expect(issues).toContainEqual({ path: "instances[0].upgrade_channel", message: "must match /^[A-Za-z0-9-]+$/" });
		expect(issues).toContainEqual({ path: "instances[0].allowed_runtime_version", message: "must be a semver range expression" });
		expect(issues).toContainEqual({ path: "instances[0].support_owner", message: "must be a non-empty string" });
		expect(issues).toContainEqual({ path: "instances[0].feature_flags.wave_autoretry", message: "must be a non-empty string" });
	});
});
