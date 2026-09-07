import { spawnSync } from "node:child_process";
import path from "node:path";

import { runPostinstallBootstrap } from "../postinstall-bootstrap.mjs";

const SCAFFOLD_FACTORY_CHILD_SOURCE = `
import { initFactory } from "./dist/factory/init.js";

const input = JSON.parse(process.env.HATCH_SCAFFOLD_FACTORY_INPUT || "{}");

const result = await initFactory(input.initOptions, {
  resolveTrackingIssue: () => input.trackingIssue,
});

process.stdout.write(JSON.stringify(result));
`;

export function scaffoldFactoryFixture({
  repoRoot,
  rootDir,
  factoryId,
  repo,
  controlPlane,
  runsDir,
  trackingIssue,
}) {
  runPostinstallBootstrap(repoRoot);

  const hatchRoot = path.join(repoRoot, "apps", "hatch");
  const childEnv = {
    ...process.env,
    HATCH_SCAFFOLD_FACTORY_INPUT: JSON.stringify({
      initOptions: {
        factoryId,
        repo,
        controlPlane,
        force: false,
        rootDir,
        runsDir,
      },
      trackingIssue,
    }),
  };

  const run = spawnSync(
    "node",
    ["--input-type=module", "-e", SCAFFOLD_FACTORY_CHILD_SOURCE],
    {
      cwd: hatchRoot,
      env: childEnv,
      encoding: "utf8",
    },
  );

  if (run.error) {
    throw run.error;
  }

  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || `scaffold factory fixture failed with exit ${run.status}`).trim());
  }

  return JSON.parse(run.stdout || "{}");
}
