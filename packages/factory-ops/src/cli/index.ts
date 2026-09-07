import { Cli } from "clipanion";

import { artifactCommands } from "./commands/artifact.ts";
import { brainstormCommands } from "./commands/brainstorm.ts";
import { commonCommands } from "./commands/common.ts";
import { doctorCommands } from "./commands/doctor.ts";
import { factoryDashboardCommands } from "./commands/factory-dashboard.ts";
import { factoryMirrorCommands } from "./commands/factory-mirror.ts";
import { factoryCommands } from "./commands/factory.ts";
import { fleetCommands } from "./commands/fleet.ts";
import { goalBlockerCommands } from "./commands/goal-blocker-cli.ts";
import { goalIssueCommands } from "./commands/goal-issue.ts";
import { goalRunCommands } from "./commands/goal-run.ts";
import { goalCommands } from "./commands/goal.ts";
import { governanceCommands } from "./commands/governance.ts";
import { graphCommands } from "./commands/graph.ts";
import { hostCommands } from "./commands/host.ts";
import { insightCommands } from "./commands/insight.ts";
import { judgeCommands } from "./commands/judge.ts";
import { labelsCommands } from "./commands/labels.ts";
import { llmCommands } from "./commands/llm.ts";
import { mergeCommands } from "./commands/merge.ts";
import { milestoneCommands } from "./commands/milestone.ts";
import { observabilityCommands } from "./commands/observability.ts";
import { packetCommands } from "./commands/packet.ts";
import { releaseCommands } from "./commands/release.ts";
import { researchCommands } from "./commands/research.ts";
import { retryCommands } from "./commands/retry.ts";
import { scenarioCommands } from "./commands/scenario.ts";
import { skillCommands } from "./commands/skill.ts";
import { supervisorCommands } from "./commands/supervisor.ts";
import { triageCommands } from "./commands/triage.ts";
import { waveIssueCommands } from "./commands/wave-issue.ts";
import { waveCommands } from "./commands/wave.ts";
import { FactoryModelPolicyCommand } from "./factory-model-policy-command.ts";
import { AnalysisDailyReportCommand } from "../commands/analysis/daily-report.ts";
import { AnalysisLensFollowupCandidatesCommand } from "../commands/analysis/lens-followup-candidates.ts";
import {
  AnalysisLensFinalizeCommand,
  AnalysisLensPrepareCommand,
} from "../commands/analysis/lens-graph-runtime.ts";
import { AnalysisLensCommand } from "../commands/analysis/lens.ts";
import { AnalysisPublishLensCommand } from "../commands/analysis/publish-lens.ts";

const allCommands = [
  ...factoryCommands,
  ...factoryDashboardCommands,
  ...factoryMirrorCommands,
  ...supervisorCommands,
  ...commonCommands,
  ...judgeCommands,
  ...goalIssueCommands,
  ...goalRunCommands,
  ...waveCommands,
  ...waveIssueCommands,
  ...milestoneCommands,
  ...mergeCommands,
  ...triageCommands,
  ...goalCommands,
  ...goalBlockerCommands,
  ...artifactCommands,
  ...observabilityCommands,
  ...labelsCommands,
  ...scenarioCommands,
  ...governanceCommands,
  ...graphCommands,
  ...hostCommands,
  ...retryCommands,
  ...skillCommands,
  ...releaseCommands,
  ...researchCommands,
  ...doctorCommands,
  ...insightCommands,
  ...packetCommands,
  ...brainstormCommands,
  ...llmCommands,
  ...fleetCommands,
  FactoryModelPolicyCommand,
  AnalysisDailyReportCommand,
  AnalysisLensPrepareCommand,
  AnalysisLensFinalizeCommand,
  AnalysisLensFollowupCandidatesCommand,
  AnalysisLensCommand,
  AnalysisPublishLensCommand,
];

/**
 * Build and return the CLI instance with all commands registered.
 *
 * Normalizes `domain run --op action` to `domain action` before
 * passing to clipanion so DOT graph invocations work unchanged.
 */
export function buildCli() {
  const cli = new Cli({
    binaryLabel: "hatch-ops",
    binaryName: "hatch-ops",
  });
  for (const cmd of allCommands) {
    cli.register(cmd);
  }
  return cli;
}

/**
 * Normalize argv to handle `domain run --op action` form.
 * Expects pre-sliced argv (no node/script prefix).
 * Converts: [domain, "run", ...rest] with --op action
 * To:       [domain, action, ...rest without --op/action]
 */
export function normalizeArgv(argv) {
  // argv = [domain, actionOrRun, ...flags]
  const args = [...argv];
  if (args.length >= 2 && args[1] === "run") {
    const opIdx = args.indexOf("--op", 2);
    const operationIdx = args.indexOf("--operation", 2);
    const idx = opIdx >= 0 ? opIdx : operationIdx;
    if (idx >= 0 && idx + 1 < args.length) {
      const action = args[idx + 1];
      args[1] = action;
      args.splice(idx, 2);
    }
  }
  return args;
}
