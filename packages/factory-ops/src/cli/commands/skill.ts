import { Command, Option } from "clipanion";

import { parseBoolFlag } from "../helpers.ts";

export class SkillScaffoldInterfaceCommand extends Command {
  static paths = [["skill", "scaffold-interface"]];
  skillName = Option.String("--skill-name", "");
  skillsRoot = Option.String("--skills-root", "factories/mothership/skills");
  owner = Option.String("--owner", "factory-owners");
  overwrite = Option.String("--overwrite", "false");
  dryRun = Option.String("--dry-run", "false");
  validateExisting = Option.String("--validate-existing", "true");

  async execute() {
    const { scaffoldSkillInterface } = await import("../../commands/skill-interface-scaffold.ts");

    const out = scaffoldSkillInterface({
      skillName: this.skillName,
      skillsRoot: this.skillsRoot,
      owner: this.owner,
      overwrite: parseBoolFlag(this.overwrite),
      dryRun: parseBoolFlag(this.dryRun),
      validateExisting: parseBoolFlag(this.validateExisting, true),
    });

    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class SkillValidateInterfaceCommand extends Command {
  static paths = [["skill", "validate-interface"]];
  skillName = Option.String("--skill-name", "");
  skillsRoot = Option.String("--skills-root", "factories/mothership/skills");
  validateExisting = Option.String("--validate-existing", "true");

  async execute() {
    const { validateSkillInterfaceAtPath } = await import("../../commands/skill-interface-scaffold.ts");

    const out = validateSkillInterfaceAtPath({
      skillName: this.skillName,
      skillsRoot: this.skillsRoot,
      validateExisting: parseBoolFlag(this.validateExisting, true),
    });

    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export const skillCommands = [
  SkillScaffoldInterfaceCommand,
  SkillValidateInterfaceCommand,
];
