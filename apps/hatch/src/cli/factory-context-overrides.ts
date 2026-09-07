import type { ResolveFactoryContextOptions } from "../factory/context-resolver.js";

export interface FactoryContextOverrideFlags {
	factoryRoot: string;
	factoryConfigPath: string;
	factoryId: string;
	targetRepo: string;
	controlPlaneRepo: string;
	runsDir: string;
	scenariosRoot: string;
	factoryMode: string;
}

export interface ParsedFactoryContextOverrideArgs {
	flags: FactoryContextOverrideFlags;
	args: string[];
}

export interface ParseFactoryContextOverrideOptions {
	repoAlias?: boolean;
}

function emptyFlags(): FactoryContextOverrideFlags {
	return {
		factoryRoot: "",
		factoryConfigPath: "",
		factoryId: "",
		targetRepo: "",
		controlPlaneRepo: "",
		runsDir: "",
		scenariosRoot: "",
		factoryMode: "",
	};
}

function parseInline(arg: string, name: string): string {
	const prefix = `${name}=`;
	if (!arg.startsWith(prefix)) return "";
	return arg.slice(prefix.length);
}

function consumeValue(args: string[], index: number): { value: string; consumed: number } {
	if (index + 1 >= args.length) return { value: "", consumed: 0 };
	return { value: args[index + 1], consumed: 1 };
}

export function parseFactoryContextOverrideArgs(
	args: string[],
	options: ParseFactoryContextOverrideOptions = {},
): ParsedFactoryContextOverrideArgs {
	const flags = emptyFlags();
	const remaining: string[] = [];
	const repoAliasEnabled = options.repoAlias ?? false;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];

		const inlineFactoryRoot = parseInline(arg, "--factory-root");
		if (inlineFactoryRoot) {
			flags.factoryRoot = inlineFactoryRoot;
			continue;
		}
		if (arg === "--factory-root") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.factoryRoot = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineFactoryConfigPath = parseInline(arg, "--factory-config-path") || parseInline(arg, "--config-path");
		if (inlineFactoryConfigPath) {
			flags.factoryConfigPath = inlineFactoryConfigPath;
			continue;
		}
		if (arg === "--factory-config-path" || arg === "--config-path") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.factoryConfigPath = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineFactoryId = parseInline(arg, "--factory-id");
		if (inlineFactoryId) {
			flags.factoryId = inlineFactoryId;
			continue;
		}
		if (arg === "--factory-id") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.factoryId = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineTargetRepo = parseInline(arg, "--target-repo")
			|| (repoAliasEnabled ? parseInline(arg, "--repo") : "");
		if (inlineTargetRepo) {
			flags.targetRepo = inlineTargetRepo;
			continue;
		}
		if (arg === "--target-repo" || (repoAliasEnabled && arg === "--repo")) {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.targetRepo = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineControlPlaneRepo = parseInline(arg, "--control-plane-repo");
		if (inlineControlPlaneRepo) {
			flags.controlPlaneRepo = inlineControlPlaneRepo;
			continue;
		}
		if (arg === "--control-plane-repo") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.controlPlaneRepo = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineRunsDir = parseInline(arg, "--runs-dir");
		if (inlineRunsDir) {
			flags.runsDir = inlineRunsDir;
			continue;
		}
		if (arg === "--runs-dir") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.runsDir = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineScenariosRoot = parseInline(arg, "--scenarios-root");
		if (inlineScenariosRoot) {
			flags.scenariosRoot = inlineScenariosRoot;
			continue;
		}
		if (arg === "--scenarios-root") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.scenariosRoot = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		const inlineFactoryMode = parseInline(arg, "--factory-mode");
		if (inlineFactoryMode) {
			flags.factoryMode = inlineFactoryMode;
			continue;
		}
		if (arg === "--factory-mode") {
			const consumed = consumeValue(args, index);
			if (consumed.consumed > 0) {
				flags.factoryMode = consumed.value;
				index += consumed.consumed;
				continue;
			}
		}

		remaining.push(arg);
	}

	return { flags, args: remaining };
}

export function buildFactoryContextResolverOptions(
	flags: FactoryContextOverrideFlags,
	overrides: Partial<ResolveFactoryContextOptions> = {},
): ResolveFactoryContextOptions {
	return {
		factoryRoot: flags.factoryRoot,
		factoryConfigPath: flags.factoryConfigPath,
		factoryId: flags.factoryId,
		targetRepo: flags.targetRepo,
		controlPlaneRepo: flags.controlPlaneRepo,
		runsDir: flags.runsDir,
		scenariosRoot: flags.scenariosRoot,
		factoryMode: flags.factoryMode,
		...overrides,
	};
}
