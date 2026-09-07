import { describe, expect, it } from "vitest";

import {
	defaultModelForProvider,
	resolveFactoryIsolationRuntimeEnv,
	resolveFactoryIsolationAuthStoragePath,
	seedRuntimeApiKeysFromEnv,
} from "./provider-defaults";

describe("provider defaults", () => {
	it("returns stable default models per provider", () => {
		expect(defaultModelForProvider("openai")).toBe("gpt-4.1");
		expect(defaultModelForProvider("google")).toBe("gemini-2.5-pro");
		expect(defaultModelForProvider("openrouter")).toBe("claude-sonnet-4-6");
	});

	it("seeds runtime api keys from process env, including openrouter", () => {
		const seeded: Array<{ provider: string; apiKey: string }> = [];
		const authStorage = {
			setRuntimeApiKey(provider: string, apiKey: string) {
				seeded.push({ provider, apiKey });
			},
		};

		seedRuntimeApiKeysFromEnv(authStorage, {
			OPENROUTER_API_KEY: "or-key",
			OPENAI_API_KEY: "oa-key",
			ANTHROPIC_API_KEY: "an-key",
			GOOGLE_API_KEY: "gg-key",
		});

		expect(seeded).toEqual([
			{ provider: "anthropic", apiKey: "an-key" },
			{ provider: "openai", apiKey: "oa-key" },
			{ provider: "openrouter", apiKey: "or-key" },
			{ provider: "google", apiKey: "gg-key" },
			{ provider: "google-gemini-cli", apiKey: "gg-key" },
		]);
	});

	it("skips empty env vars", () => {
		const seeded: Array<{ provider: string; apiKey: string }> = [];
		const authStorage = {
			setRuntimeApiKey(provider: string, apiKey: string) {
				seeded.push({ provider, apiKey });
			},
		};

		seedRuntimeApiKeysFromEnv(authStorage, {
			OPENROUTER_API_KEY: "   ",
		});

		expect(seeded).toEqual([]);
	});

	it("applies per-factory provider/model overrides into runtime env", () => {
		const env = resolveFactoryIsolationRuntimeEnv({
			env: {},
			isolationConfig: {
				provider: { envVar: "HATCH_MODEL_PROVIDER", value: "openai" },
				model: { envVar: "HATCH_MODEL", value: "gpt-5.4" },
			},
		});

		expect(env.HATCH_MODEL_PROVIDER).toBe("openai");
		expect(env.HATCH_PROVIDER).toBe("openai");
		expect(env.HATCH_MODEL).toBe("gpt-5.4");
	});

	it("resolves auth storage path from factory isolation config", () => {
		const path = resolveFactoryIsolationAuthStoragePath({
			env: {},
			isolationConfig: {
				authStoragePath: "~/.pi/auth-factory-a.json",
			},
			homeDir: "/home/example",
		});

		expect(path).toBe("/home/example/.pi/auth-factory-a.json");
	});
});
