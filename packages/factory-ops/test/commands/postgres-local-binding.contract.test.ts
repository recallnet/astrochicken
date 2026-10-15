import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("development event store publishes only on loopback by default", () => {
  const composePath = fileURLToPath(new URL("../../config/postgres/canonical-event-store.compose.yml", import.meta.url));
  const rendered = JSON.parse(execFileSync("docker", ["compose", "-f", composePath, "config", "--format", "json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      POSTGRES_BIND_HOST: "",
      POSTGRES_PORT: "55432",
      POSTGRES_DB: "fixture",
      POSTGRES_USER: "fixture",
      POSTGRES_PASSWORD: "development-only",
      CANONICAL_EVENT_STORE_ROOT: "/tmp/astro-compose-render",
    },
  }));
  assert.equal(rendered.services.postgres.ports[0].host_ip, "127.0.0.1");
  assert.match(rendered.services.postgres.healthcheck.test.join(" "), /pg_isready -h 127\.0\.0\.1/);
});
