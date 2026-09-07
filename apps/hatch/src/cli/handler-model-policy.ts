import type { FactoryContext } from "../factory/context-resolver.js";
import {
	resolveEffectiveModelPolicyForFactoryConfig,
	resolveEffectiveModelPolicyForPipeline,
	type EffectiveModelPolicy,
} from "../factory/model-policy.js";

export function resolveHandlerModelPolicy(args: {
	pipelineFile?: string;
	factoryContext?: FactoryContext;
	env?: Record<string, string | undefined>;
}): EffectiveModelPolicy | undefined {
	const runtimeEnv = args.env ?? process.env;
	const explicitFactoryConfigPath = String(args.factoryContext?.factory_config_path || "").trim();
	if (explicitFactoryConfigPath) {
		return resolveEffectiveModelPolicyForFactoryConfig({
			factoryConfigPath: explicitFactoryConfigPath,
			env: runtimeEnv,
		});
	}
	if (!args.pipelineFile) return undefined;
	return resolveEffectiveModelPolicyForPipeline({
		pipelineFile: args.pipelineFile,
		env: runtimeEnv,
	});
}
