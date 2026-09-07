export * from "./factory-status-cmds.ts";
export * from "./factory-host-cmds.ts";
export * from "./factory-control-cmds.ts";
export * from "./factory-fleet-triage-cmds.ts";
export * from "./factory-fleet-triage-queues.ts";
export * from "./factory-lease-cmds.ts";
export * from "./factory-release-cmds.ts";
export * from "./factory-service-profile-cmds.ts";
export * from "./factory-scheduled-jobs-status.ts";

import { factoryControlCommands } from "./factory-control-cmds.ts";
import { factoryFleetTriageCommands } from "./factory-fleet-triage-cmds.ts";
import { factoryFleetTriageQueuesCommands } from "./factory-fleet-triage-queues.ts";
import { factoryHostCommands } from "./factory-host-cmds.ts";
import { factoryLeaseCommands } from "./factory-lease-cmds.ts";
import { factoryReleaseCommands } from "./factory-release-cmds.ts";
import { factoryScheduledJobsStatusCommands } from "./factory-scheduled-jobs-status.ts";
import { factoryServiceProfileCommands } from "./factory-service-profile-cmds.ts";
import { factoryStatusCommands } from "./factory-status-cmds.ts";

export const factoryCommands = [
  ...factoryStatusCommands,
  ...factoryHostCommands,
  ...factoryControlCommands,
  ...factoryLeaseCommands,
  ...factoryReleaseCommands,
  ...factoryServiceProfileCommands,
  ...factoryScheduledJobsStatusCommands,
  ...factoryFleetTriageCommands,
  ...factoryFleetTriageQueuesCommands,
];
