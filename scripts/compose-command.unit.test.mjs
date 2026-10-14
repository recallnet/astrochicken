import assert from "node:assert/strict";
import test from "node:test";
import { createComposeCommand } from "./test/helpers/compose-command.ts";

test("compose fixture executes Docker argv without a host shell or login PATH reset", () => {
  const calls = [];
  const compose = createComposeCommand({ repoRoot: "/repo with spaces", composePath: "/repo with spaces/compose.yml", project: "fixture_123", envPath: "/tmp/env file", spawn(command, args, options) { calls.push({ command, args, options }); return { status: 0, stdout: "ready" }; } });
  assert.equal(compose("up", "-d", "postgres"), "ready");
  assert.equal(calls[0].command, "docker");
  assert.deepEqual(calls[0].args, ["compose", "-p", "fixture_123", "-f", "/repo with spaces/compose.yml", "--env-file", "/tmp/env file", "up", "-d", "postgres"]);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.env.PATH, process.env.PATH);
});

test("compose fixture reports spawn failures and command stderr", () => {
  const options = { repoRoot: "/repo", composePath: "/compose", project: "fixture", envPath: "/env" };
  assert.throws(() => createComposeCommand({ ...options, spawn: () => ({ status: null, error: new Error("spawn docker ENOENT") }) })("up"), /spawn docker ENOENT/);
  assert.throws(() => createComposeCommand({ ...options, spawn: () => ({ status: 1, stderr: "daemon unavailable" }) })("up"), /status=1.*daemon unavailable/);
});
