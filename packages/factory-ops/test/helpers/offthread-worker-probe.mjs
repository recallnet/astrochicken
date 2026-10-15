import { register } from "node:module";
import { workerData } from "node:worker_threads";

register("./offthread-worker-probe-loader.mjs", import.meta.url);
await import(workerData.workerUrl);
workerData.control.on("message", async ({ id, action }) => {
  try {
    let result;
    if (action === "report") {
      result = (await import("publication:import-report")).default;
    } else if (action === "settle") {
      // Resolve the actual dependency modules as a positive completion barrier;
      // any earlier ping-prefetch callbacks must settle before this replies.
      await Promise.all([
        import(new URL("../commands/factory-fleet-status.ts", workerData.workerUrl).href),
        import(new URL("../commands/factory-dashboard.ts", workerData.workerUrl).href),
      ]);
      result = true;
    } else throw new Error("unknown_probe_action");
    workerData.control.postMessage({ id, result });
  } catch (error) {
    workerData.control.postMessage({ id, error: error.message });
  }
});
