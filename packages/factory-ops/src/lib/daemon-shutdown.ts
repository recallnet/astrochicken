function trim(value = "") {
  return String(value || "").trim();
}

export async function terminateActiveChildAndExit({
  signal = "SIGTERM",
  activeChildRef = { current: null },
  daemonPaths = {},
  daemonLogPath = "",
  leaseReleaseFn = () => ({ ok: true, reason: "lease_missing" }),
  appendLogLineFn = () => {},
  releaseDaemonLockFn = () => {},
  processExitFn = process.exit,
} = {}) {
  const child = activeChildRef.current;
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {}

    const killer = setTimeout(() => {
      try {
        if (activeChildRef.current) activeChildRef.current.kill("SIGKILL");
      } catch {}
    }, 1000);
    killer.unref();

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once("exit", finish);
      setTimeout(finish, 1200).unref();
    });
  }

  const leaseRelease = leaseReleaseFn({ runtime: {}, paths: daemonPaths });
  appendLogLineFn(
    daemonLogPath,
    `lease_release reason=shutdown signal=${signal} ok=${leaseRelease.ok ? "true" : "false"} detail=${trim(leaseRelease.reason || "unknown") || "unknown"}`,
  );
  appendLogLineFn(daemonLogPath, `daemon_exit signal=${signal}`);
  releaseDaemonLockFn(daemonPaths);
  processExitFn(signal === "SIGTERM" ? 0 : 1);
}
