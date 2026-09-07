import { Command, Option } from "clipanion";

export class FactoryServiceProfileInspectCommand extends Command {
  static paths = [["factory", "service-profile", "inspect"]];

  instanceId = Option.String();
  registryPath = Option.String("--registry-path", "factory-registry.json");

  async execute() {
    const { inspectFactoryServiceProfile } = await import("../../commands/factory-service-profile.ts");
    try {
      const out = inspectFactoryServiceProfile({
        instanceId: this.instanceId,
        registryPath: this.registryPath,
      });
      this.context.stdout.write(`${JSON.stringify(out.service_profile, null, 2)}\n`);
      return 0;
    } catch (error) {
      const { normalizeFactoryOpsError } = await import("../../lib/error-catalog.ts");
      const normalized = normalizeFactoryOpsError(error, "service_profile_inspect_failed");
      this.context.stderr.write(`${normalized.message}\n`);
      return 1;
    }
  }
}

export class FactoryServiceProfileUpdateCommand extends Command {
  static paths = [["factory", "service-profile", "update"]];

  instanceId = Option.String();
  profilePath = Option.String("--profile", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");

  async execute() {
    const { updateFactoryServiceProfile } = await import("../../commands/factory-service-profile.ts");
    try {
      const out = updateFactoryServiceProfile({
        instanceId: this.instanceId,
        profilePath: this.profilePath,
        registryPath: this.registryPath,
      });
      this.context.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return 0;
    } catch (error) {
      const { normalizeFactoryOpsError } = await import("../../lib/error-catalog.ts");
      const normalized = normalizeFactoryOpsError(error, "service_profile_update_failed");
      this.context.stderr.write(`${normalized.message}\n`);
      return 1;
    }
  }
}

export const factoryServiceProfileCommands = [
  FactoryServiceProfileInspectCommand,
  FactoryServiceProfileUpdateCommand,
];
