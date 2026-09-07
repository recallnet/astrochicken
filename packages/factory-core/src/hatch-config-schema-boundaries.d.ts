import type { BoundarySchemaDefinition } from "@hatch/factory-core/schema-registry";
import type { $ZodError, ZodType } from "zod/v4/core";

export const FACTORY_CONFIG_SCHEMA_VERSION: "hatch.factory.config.v1";
export const FACTORY_KIND_EXECUTION_MODES: readonly ["issues_only", "code"];
export const FACTORY_INSTALLATION_WORKSPACE_MODES: readonly ["api_only", "checkout", "worktree"];

export const factoryConfigDocumentSchema: ZodType;
export const factoryKindDefinitionDocumentSchema: ZodType;
export const factoryInstanceManifestDocumentSchema: ZodType;
export const factoryServiceRegistryDocumentSchema: ZodType;
export const factoryInstallationManifestDocumentSchema: ZodType;

export const FACTORY_CONFIG_BOUNDARY_SCHEMA: Readonly<BoundarySchemaDefinition>;
export const FACTORY_KIND_DEFINITION_BOUNDARY_SCHEMA: Readonly<BoundarySchemaDefinition>;
export const FACTORY_INSTANCE_MANIFEST_BOUNDARY_SCHEMA: Readonly<BoundarySchemaDefinition>;
export const FACTORY_SERVICE_REGISTRY_BOUNDARY_SCHEMA: Readonly<BoundarySchemaDefinition>;
export const FACTORY_INSTALLATION_MANIFEST_BOUNDARY_SCHEMA: Readonly<BoundarySchemaDefinition>;

export interface FactoryConfigIssueLike {
	path: string;
	message: string;
}

export function finalizeIssues(issues: FactoryConfigIssueLike[]): FactoryConfigIssueLike[];
export function appendSchemaIssues(issues: FactoryConfigIssueLike[], error: $ZodError): void;
