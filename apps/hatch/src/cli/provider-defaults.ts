import path from "node:path";

import type { FactoryIsolationConfig } from "../factory/config-schema.js";

export function defaultModelForProvider(provider: string): string {
	switch (provider) {
		case "openai":
			return "gpt-4.1";
		case "google":
		case "google-gemini-cli":
			return "gemini-2.5-pro";
		default:
			return "claude-sonnet-4-6";
	}
}

type RuntimeAuthStorage = {
	setRuntimeApiKey(provider: string, apiKey: string): void;
};

const PROVIDER_ENV_KEYS = Object.freeze({
	anthropic: ["ANTHROPIC_API_KEY"],
	openai: ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY"],
	openrouter: ["OPENROUTER_API_KEY"],
	google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	"google-gemini-cli": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
});

export function seedRuntimeApiKeysFromEnv(
	authStorage: RuntimeAuthStorage,
	env: NodeJS.ProcessEnv = process.env,
): void {
	for (const [provider, envKeys] of Object.entries(PROVIDER_ENV_KEYS)) {
		for (const envKey of envKeys) {
			const apiKey = String(env[envKey] || "").trim();
			if (!apiKey) continue;
			authStorage.setRuntimeApiKey(provider, apiKey);
			break;
		}
	}
}

export function resolveFactoryIsolationRuntimeEnv(args: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	isolationConfig?: FactoryIsolationConfig;
}): NodeJS.ProcessEnv {
	const env = { ...(args.env ?? process.env) } as NodeJS.ProcessEnv;
	const providerValue = trim(args.isolationConfig?.provider?.value);
	const providerEnvVar = trim(args.isolationConfig?.provider?.envVar) || "HATCH_MODEL_PROVIDER";
	if (providerValue) {
		env[providerEnvVar] = providerValue;
		env.HATCH_PROVIDER = providerValue;
	}

	const modelValue = trim(args.isolationConfig?.model?.value);
	const modelEnvVar = trim(args.isolationConfig?.model?.envVar) || "HATCH_MODEL";
	if (modelValue) {
		env[modelEnvVar] = modelValue;
		env.HATCH_MODEL = modelValue;
	}

	const authStoragePath = resolveFactoryIsolationAuthStoragePath({
		env,
		isolationConfig: args.isolationConfig,
	});
	if (authStoragePath) {
		env.HATCH_AUTH_STORAGE_PATH = authStoragePath;
	}

	return env;
}

export function resolveFactoryIsolationAuthStoragePath(args: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	isolationConfig?: FactoryIsolationConfig;
	homeDir?: string;
}): string {
	const env = args.env ?? process.env;
	const configured = trim(args.isolationConfig?.authStoragePath) || trim(env.HATCH_AUTH_STORAGE_PATH);
	if (!configured) return "";
	return expandHomePath(configured, args.homeDir || process.env.HOME || "");
}

function expandHomePath(value: string, homeDir: string): string {
	if (value === "~") return homeDir || value;
	if (value.startsWith("~/")) {
		return homeDir ? path.join(homeDir, value.slice(2)) : value;
	}
	return value;
}

function trim(value: string | undefined): string {
	return String(value || "").trim();
}
