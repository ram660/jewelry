import { DatabaseSync } from "node:sqlite";
import type { RelayEvent, Store, StoredEvent } from "./relay.ts";

/** Durable queue in one SQLite file. Needs Node 22.13 or newer and no packages. */
export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
        id          TEXT NOT NULL UNIQUE,
        kind        TEXT NOT NULL,
        account     TEXT NOT NULL,
        sender      TEXT NOT NULL,
        text        TEXT NOT NULL,
        ref         TEXT,
        parent      TEXT,
        at          INTEGER NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('epoch', ?)").run(crypto.randomUUID());
  }

  async epoch(): Promise<string> {
    return String((this.db.prepare("SELECT value FROM meta WHERE key = 'epoch'").get() as { value: string }).value);
  }

  async add(events: RelayEvent[]): Promise<number> {
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO events (id, kind, account, sender, text, ref, parent, at, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let n = 0;
    this.db.exec("BEGIN");
    try {
      for (const e of events) {
        const r = ins.run(e.id, e.kind, e.account, e.from, e.text, e.ref ?? null, e.parent ?? null, e.at, Date.now());
        n += Number(r.changes);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return n;
  }

  async list(afterSeq: number, limit: number): Promise<StoredEvent[]> {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?")
      .all(afterSeq, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      id: String(r.id),
      kind: String(r.kind) as StoredEvent["kind"],
      account: String(r.account),
      from: String(r.sender),
      text: String(r.text),
      ref: r.ref == null ? undefined : String(r.ref),
      parent: r.parent == null ? undefined : String(r.parent),
      at: Number(r.at),
    }));
  }

  async prune(beforeMs: number): Promise<void> {
    this.db.prepare("DELETE FROM events WHERE received_at < ?").run(beforeMs);
  }

  close(): void {
    this.db.close();
  }
}
