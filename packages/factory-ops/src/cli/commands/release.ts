export * from "./release-context-cmds.ts";
export * from "./release-delivery-cmds.ts";
export * from "./release-policy-cmds.ts";

import { releaseContextCommands } from "./release-context-cmds.ts";
import { releaseDeliveryCommands } from "./release-delivery-cmds.ts";
import { releasePolicyCommands } from "./release-policy-cmds.ts";

export const releaseCommands = [
  ...releaseContextCommands,
  ...releaseDeliveryCommands,
  ...releasePolicyCommands,
];
