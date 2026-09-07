import { Command } from "clipanion";

export class DoctorRelinkCliCommand extends Command {
  static paths = [["doctor", "relink-cli"]];

  async execute() {
    const { relinkGlobalCli } = await import("../../lib/global-cli-link.ts");
    const out = relinkGlobalCli();
    this.context.stdout.write(`${JSON.stringify(out)}\n`);
    return out.relinked ? 0 : 2;
  }
}

export class DoctorCanonicalCheckoutCommand extends Command {
  static paths = [["doctor", "canonical-checkout"]];

  async execute() {
    const { inspectCanonicalCheckout } = await import("../../lib/canonical-checkout-doctor.ts");
    const out = inspectCanonicalCheckout();
    this.context.stdout.write(`${JSON.stringify(out)}\n`);
    return out.ok ? 0 : 2;
  }
}

export class DoctorRepairCanonicalCheckoutCommand extends Command {
  static paths = [["doctor", "repair-canonical-checkout"]];

  async execute() {
    const { repairCanonicalCheckout } = await import("../../lib/canonical-checkout-doctor.ts");
    const out = repairCanonicalCheckout();
    this.context.stdout.write(`${JSON.stringify(out)}\n`);
    return out.ok ? 0 : 2;
  }
}

export const doctorCommands = [
  DoctorCanonicalCheckoutCommand,
  DoctorRepairCanonicalCheckoutCommand,
  DoctorRelinkCliCommand,
];
