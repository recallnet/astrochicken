import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("publishWaveDemoArtifact contract includes artifact_url and demo_artifact_url keys", () => {
  const src = readFileSync("packages/factory-ops/src/commands/wave-demo-publish.ts", "utf8");
  assert.ok(src.includes("artifact_url"), "publishWaveDemoArtifact must return artifact_url");
  assert.ok(src.includes("demo_artifact_url"), "publishWaveDemoArtifact must return demo_artifact_url");
  assert.ok(src.includes("demo_publish_status"), "publishWaveDemoArtifact must return demo_publish_status");
  assert.ok(src.includes("demo_publish_error"), "publishWaveDemoArtifact must return demo_publish_error");
  assert.ok(src.includes("goalIngest: true"), "publish must route through goalIngest artifact publication");
  assert.ok(src.includes("artifactType: \"wave-demo-terminal\""), "publish must use wave-demo-terminal artifact type");
});

test("wave CLI registers demo-terminal and demo-publish commands", () => {
  const cliSrc = readFileSync("packages/factory-ops/src/cli/commands/wave.ts", "utf8");
  assert.ok(cliSrc.includes("class WaveDemoTerminalCommand"), "wave demo-terminal command class must exist");
  assert.ok(cliSrc.includes("class WaveDemoPublishCommand"), "wave demo-publish command class must exist");
  assert.ok(cliSrc.includes("WaveDemoTerminalCommand"), "waveCommands must include WaveDemoTerminalCommand");
  assert.ok(cliSrc.includes("WaveDemoPublishCommand"), "waveCommands must include WaveDemoPublishCommand");
});

test("software-development in-process owners export wave demo generator and publisher", () => {
  const ownersSrc = readFileSync("packages/capability-software-development/src/in-process-action-owners.mjs", "utf8");
  assert.ok(ownersSrc.includes("generateWaveTerminalDemo"), "in-process owners must export generateWaveTerminalDemo");
  assert.ok(ownersSrc.includes("publishWaveDemoArtifact"), "in-process owners must export publishWaveDemoArtifact");
});
