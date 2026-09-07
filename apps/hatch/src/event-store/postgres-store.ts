import { Pool, type PoolClient } from "pg";

import {
	type CanonicalEventEnvelope,
	validateCanonicalEventEnvelope,
} from "./envelope.js";
import { buildCanonicalEventStorePgClientConfig } from "./postgres-client-options.js";

export type CanonicalEventStoreRow = CanonicalEventEnvelope & {
	commit_cursor: number;
	batch_offset: number;
	recorded_at: string;
};

export type CanonicalEventStore = {
	ensureSchema(): Promise<void>;
	append(events: CanonicalEventEnvelope[]): Promise<CanonicalEventStoreRow[]>;
	read(afterCursor?: number): Promise<CanonicalEventStoreRow[]>;
	subscribe(listener: (event: CanonicalEventStoreRow) => void): () => void;
	close(): Promise<void>;
};

const SCHEMA_SQL = `
create sequence if not exists canonical_event_commit_seq;
create table if not exists factory_events (
  event_id uuid primary key,
  commit_cursor bigint not null,
  batch_offset integer not null,
  schema text not null,
  event_family text not null,
  event_version integer not null,
  factory_id text not null,
  run_id text,
  emitter text not null,
  emitted_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  event_origin text not null,
  provenance jsonb not null default '{}'::jsonb,
  payload jsonb not null
);
create index if not exists idx_factory_events_factory_cursor on factory_events(factory_id, commit_cursor, batch_offset);
create index if not exists idx_factory_events_commit_cursor on factory_events(commit_cursor, batch_offset);
create index if not exists idx_factory_events_run_id on factory_events(run_id);
`;

function mapRow(row: Record<string, unknown>): CanonicalEventStoreRow {
	return {
		schema: "canonical_event_envelope/v1",
		event_id: String(row.event_id),
		event_family: String(row.event_family),
		event_version: Number(row.event_version),
		factory_id: String(row.factory_id),
		run_id: row.run_id ? String(row.run_id) : undefined,
		emitter: String(row.emitter),
		emitted_at: new Date(String(row.emitted_at)).toISOString(),
		recorded_at: new Date(String(row.recorded_at)).toISOString(),
		event_origin: row.event_origin === "backfill" ? "backfill" : "runtime",
		provenance: row.provenance && typeof row.provenance === "object" ? (row.provenance as CanonicalEventStoreRow["provenance"]) : undefined,
		payload: (row.payload as Record<string, unknown>) || {},
		commit_cursor: Number(row.commit_cursor),
		batch_offset: Number(row.batch_offset),
	};
}

async function nextCommitCursor(client: PoolClient): Promise<number> {
	const result = await client.query<{ nextval: string }>("select nextval('canonical_event_commit_seq')");
	return Number(result.rows[0]?.nextval || 0);
}

export function createCanonicalPostgresEventStore({
	connectionString,
	subscribePollIntervalMs = 1000,
}: {
	connectionString: string;
	subscribePollIntervalMs?: number;
}): CanonicalEventStore {
	const pool = new Pool(buildCanonicalEventStorePgClientConfig({ connectionString }));

	return {
		async ensureSchema() {
			await pool.query(SCHEMA_SQL);
		},

		async append(events) {
			if (!Array.isArray(events) || events.length === 0) {
				return [];
			}
			const client = await pool.connect();
			try {
				await client.query("begin");
				const commitCursor = await nextCommitCursor(client);
				const appended: CanonicalEventStoreRow[] = [];
				for (const [index, event] of events.entries()) {
					const validation = validateCanonicalEventEnvelope(event);
					if (!validation.ok) {
						throw new Error(`invalid canonical event envelope: ${validation.errors.join("; ")}`);
					}
					const result = await client.query(
						`insert into factory_events (
              event_id, commit_cursor, batch_offset, schema, event_family, event_version,
              factory_id, run_id, emitter, emitted_at, event_origin, provenance, payload
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
            returning *`,
						[
							event.event_id,
							commitCursor,
							index,
							event.schema,
							event.event_family,
							event.event_version,
							event.factory_id,
							event.run_id || null,
							event.emitter,
							event.emitted_at,
							event.event_origin,
							JSON.stringify(event.provenance || {}),
							JSON.stringify(event.payload || {}),
						],
					);
					appended.push(mapRow(result.rows[0] as Record<string, unknown>));
				}
				await client.query("commit");
				return appended;
			} catch (error) {
				await client.query("rollback").catch(() => {});
				throw error;
			} finally {
				client.release();
			}
		},

		async read(afterCursor = 0) {
			const result = await pool.query(
				`select * from factory_events
         where commit_cursor > $1
         order by commit_cursor asc, batch_offset asc`,
				[afterCursor],
			);
			return result.rows.map((row: Record<string, unknown>) => mapRow(row));
		},

		subscribe(listener) {
			let lastSeen = 0;
			let disposed = false;
			let inFlight = false;
			const timer = setInterval(async () => {
				if (disposed || inFlight) return;
				inFlight = true;
				try {
					const rows = await this.read(lastSeen);
					for (const row of rows) {
						lastSeen = Math.max(lastSeen, row.commit_cursor);
						listener(row);
					}
				} finally {
					inFlight = false;
				}
			}, subscribePollIntervalMs);

			return () => {
				disposed = true;
				clearInterval(timer);
			};
		},

		async close() {
			await pool.end();
		},
	};
}
