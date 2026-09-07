import {
	inferFactoryTelemetryIdentityFromPipelineConfig,
	type FactoryConfigTelemetryIdentity,
} from "../pipeline/run.js";

export function readFactoryTelemetryIdentityForRun(pipelineFile: string): FactoryConfigTelemetryIdentity {
	const identity = inferFactoryTelemetryIdentityFromPipelineConfig(pipelineFile);
	if (identity.validation.status === "invalid") {
		throw new Error(`factory config validation failed (${identity.validation.configPath}): ${identity.validation.message}`);
	}
	return identity;
}
