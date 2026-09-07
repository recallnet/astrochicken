import { statSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";

/** TriggerConfig defines when to run a pipeline. */
export interface TriggerConfig {
	/** Watch file paths for changes. */
	files?: string[];
	/** Cron-like interval in seconds. */
	intervalSec?: number;
	/** Run once on startup before watching. */
	runOnStart?: boolean;
}

/** Parse trigger config from CLI args. */
export function parseTriggerArgs(args: string[]): { file: string; trigger: TriggerConfig } {
	let file = "";
	const trigger: TriggerConfig = {};
	const watchFiles: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--watch" && i + 1 < args.length) {
			watchFiles.push(resolve(args[++i]));
		} else if (arg === "--interval" && i + 1 < args.length) {
			trigger.intervalSec = parseInt(args[++i], 10);
		} else if (arg === "--run-on-start") {
			trigger.runOnStart = true;
		} else if (!file) {
			file = args[i];
		}
	}

	if (watchFiles.length > 0) trigger.files = watchFiles;

	return { file, trigger };
}

/** WatchLoop manages file watching and interval triggers. */
export class WatchLoop {
	private running = false;
	private intervals: ReturnType<typeof setInterval>[] = [];

	constructor(
		private trigger: TriggerConfig,
		private onTrigger: () => Promise<void>,
	) {}

	async start(signal?: AbortSignal): Promise<void> {
		this.running = true;

		if (signal) {
			signal.addEventListener("abort", () => this.stop(), { once: true });
		}

		// Run on start if configured
		if (this.trigger.runOnStart) {
			await this.runSafe();
		}

		// File watching
		if (this.trigger.files) {
			for (const file of this.trigger.files) {
				if (!existsSync(file)) {
					console.error(`watch: file not found: ${file}`);
					continue;
				}

				let lastMtime = statSync(file).mtimeMs;

				const checkInterval = setInterval(() => {
					if (!this.running) return;
					try {
						const currentMtime = statSync(file).mtimeMs;
						if (currentMtime > lastMtime) {
							lastMtime = currentMtime;
							console.log(`watch: ${file} changed`);
							this.runSafe();
						}
					} catch {
						// File might be temporarily unavailable
					}
				}, 1000);

				this.intervals.push(checkInterval);
			}
		}

		// Interval trigger
		if (this.trigger.intervalSec && this.trigger.intervalSec > 0) {
			const interval = setInterval(() => {
				if (!this.running) return;
				console.log(`watch: interval trigger (${this.trigger.intervalSec}s)`);
				this.runSafe();
			}, this.trigger.intervalSec * 1000);

			this.intervals.push(interval);
		}

		// Keep process alive
		if (this.intervals.length > 0) {
			await new Promise<void>((resolve) => {
				const check = setInterval(() => {
					if (!this.running) {
						clearInterval(check);
						resolve();
					}
				}, 500);
			});
		}
	}

	stop(): void {
		this.running = false;
		for (const interval of this.intervals) {
			clearInterval(interval);
		}
		this.intervals = [];
	}

	private async runSafe(): Promise<void> {
		try {
			await this.onTrigger();
		} catch (err) {
			console.error(`watch: run failed: ${err instanceof Error ? err.message : err}`);
		}
	}
}
