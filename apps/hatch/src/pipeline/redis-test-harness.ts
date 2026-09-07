export interface HarnessRedisClient {
	xadd(args: {
		key: string;
		maxLen?: number;
		fields: Record<string, string>;
	}): Promise<string>;
	xread(args: {
		streams: Array<{ key: string; id: string }>;
		blockMs?: number;
		count?: number;
	}): Promise<Array<{ key: string; entries: Array<{ id: string; fields: Record<string, string> }> }>>;
	xrange(args: {
		key: string;
		start?: string;
		end?: string;
		count?: number;
	}): Promise<Array<{ id: string; fields: Record<string, string> }>>;
	smembers(key: string): Promise<string[]>;
	sadd(key: string, member: string): Promise<number>;
}

interface HarnessStreamEntry {
	id: string;
	fields: Record<string, string>;
}

export class InMemoryRedisHarness implements HarnessRedisClient {
	private readonly streams = new Map<string, HarnessStreamEntry[]>();
	private readonly sets = new Map<string, Set<string>>();
	private seq = 0;
	private readonly readers: Array<{
		resolve: (rows: Array<{ key: string; entries: Array<{ id: string; fields: Record<string, string> }> }>) => void;
		streams: Array<{ key: string; id: string }>;
		count?: number;
		timer?: ReturnType<typeof setTimeout>;
	}> = [];

	async xadd(args: {
		key: string;
		maxLen?: number;
		fields: Record<string, string>;
	}): Promise<string> {
		const id = `${Date.now()}-${++this.seq}`;
		const row = { id, fields: { ...args.fields } };
		const bucket = this.streams.get(args.key) ?? [];
		bucket.push(row);
		if (args.maxLen && args.maxLen > 0 && bucket.length > args.maxLen) {
			bucket.splice(0, bucket.length - args.maxLen);
		}
		this.streams.set(args.key, bucket);
		this.wakeReaders();
		return id;
	}

	async xread(args: {
		streams: Array<{ key: string; id: string }>;
		blockMs?: number;
		count?: number;
	}): Promise<Array<{ key: string; entries: Array<{ id: string; fields: Record<string, string> }> }>> {
		const rows = this.collectRows(args.streams, args.count);
		if (rows.length > 0 || !args.blockMs || args.blockMs <= 0) return rows;
		return await new Promise((resolve) => {
			const waiter = {
				resolve,
				streams: args.streams,
				count: args.count,
				timer: setTimeout(() => {
					this.removeReader(waiter);
					resolve([]);
				}, args.blockMs),
			};
			this.readers.push(waiter);
		});
	}

	async xrange(args: {
		key: string;
		start?: string;
		end?: string;
		count?: number;
	}): Promise<Array<{ id: string; fields: Record<string, string> }>> {
		const start = args.start ?? "-";
		const end = args.end ?? "+";
		const rows = (this.streams.get(args.key) ?? []).filter((entry) => {
			if (start !== "-" && compareStreamId(entry.id, start) < 0) return false;
			if (end !== "+" && compareStreamId(entry.id, end) > 0) return false;
			return true;
		});
		if (args.count && args.count > 0) {
			return rows.slice(0, args.count).map(cloneEntry);
		}
		return rows.map(cloneEntry);
	}

	async smembers(key: string): Promise<string[]> {
		return Array.from(this.sets.get(key) ?? new Set<string>());
	}

	async sadd(key: string, member: string): Promise<number> {
		const set = this.sets.get(key) ?? new Set<string>();
		const before = set.size;
		set.add(member);
		this.sets.set(key, set);
		return set.size > before ? 1 : 0;
	}

	private collectRows(
		streams: Array<{ key: string; id: string }>,
		count?: number,
	): Array<{ key: string; entries: Array<{ id: string; fields: Record<string, string> }> }> {
		const out: Array<{ key: string; entries: Array<{ id: string; fields: Record<string, string> }> }> = [];
		for (const stream of streams) {
			const all = this.streams.get(stream.key) ?? [];
			const entries = all
				.filter((entry) => compareStreamId(entry.id, stream.id) > 0)
				.map(cloneEntry);
			if (entries.length === 0) continue;
			out.push({
				key: stream.key,
				entries: count && count > 0 ? entries.slice(0, count) : entries,
			});
		}
		return out;
	}

	private wakeReaders(): void {
		for (const reader of [...this.readers]) {
			const rows = this.collectRows(reader.streams, reader.count);
			if (rows.length === 0) continue;
			this.removeReader(reader);
			reader.resolve(rows);
		}
	}

	private removeReader(reader: {
		resolve: (rows: Array<{ key: string; entries: Array<{ id: string; fields: Record<string, string> }> }>) => void;
		streams: Array<{ key: string; id: string }>;
		count?: number;
		timer?: ReturnType<typeof setTimeout>;
	}): void {
		const idx = this.readers.indexOf(reader);
		if (idx >= 0) this.readers.splice(idx, 1);
		if (reader.timer) clearTimeout(reader.timer);
	}
}

function compareStreamId(a: string, b: string): number {
	const [aMs, aSeq] = splitId(a);
	const [bMs, bSeq] = splitId(b);
	if (aMs !== bMs) return aMs - bMs;
	return aSeq - bSeq;
}

function splitId(value: string): [number, number] {
	const [msRaw, seqRaw] = String(value || "0-0").split("-");
	return [Number(msRaw) || 0, Number(seqRaw) || 0];
}

function cloneEntry(entry: HarnessStreamEntry): { id: string; fields: Record<string, string> } {
	return {
		id: entry.id,
		fields: { ...entry.fields },
	};
}
