export type Handler = (args: { id: string; ciphertext: string }) => void;

const STORAGE_LIMIT = 100 * 1024 * 1024; // 100 MB

export class Service {
  private handlers = new Map<string, Set<Handler>>();

  constructor(private sql: SqlStorage) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        last_accessed INTEGER NOT NULL DEFAULT 0
      )
    `);
    try { sql.exec(`ALTER TABLE clips ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0`); } catch {}
    sql.exec(`CREATE INDEX IF NOT EXISTS clips_by_accessed ON clips (last_accessed DESC)`);
  }

  async update({ id, ciphertext }: { id: string; ciphertext: string }) {
    if (ciphertext.length >= 131072) throw new Error("too large");
    this.sql.exec(
      `INSERT INTO clips (id, ciphertext, last_accessed) VALUES (?, ?, unixepoch())
       ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, last_accessed = unixepoch()`,
      id,
      ciphertext,
    );
    this.cleanup();
    for (const handler of this.handlers.get(id) ?? []) {
      handler({ id, ciphertext });
    }
  }

  private cleanup() {
    while (true) {
      const [{ total }] = this.sql.exec<{ total: number }>(
        `SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) as total FROM clips`,
      ).toArray();
      if (total <= STORAGE_LIMIT) break;
      this.sql.exec(`DELETE FROM clips WHERE rowid = (SELECT MIN(rowid) FROM clips)`);
    }
  }

  async load({ id }: { id: string }): Promise<string | null> {
    this.sql.exec(`UPDATE clips SET last_accessed = unixepoch() WHERE id = ?`, id);
    const rows = this.sql.exec<{ ciphertext: string }>(
      `SELECT ciphertext FROM clips WHERE id = ?`,
      id,
    ).toArray();
    return rows[0]?.ciphertext ?? null;
  }

  systemStats({ wsConnections, idHandlers }: { wsConnections: number; idHandlers: number }): string {
    const [{ total, count }] = this.sql.exec<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) as total, COUNT(*) as count FROM clips`,
    ).toArray();
    const boards = this.sql.exec<{ id: string; len: number; last_accessed: number }>(
      `SELECT id, LENGTH(ciphertext) as len, last_accessed FROM clips ORDER BY last_accessed DESC`,
    ).toArray();
    const lines = [
      `total size: ${(total / 1024).toFixed(2)} kb`,
      `total boards: ${count}`,
      `ws connections: ${wsConnections}`,
      `id handlers: ${idHandlers}`,
      "",
      ...boards.map((r) => `${r.id}: ${r.len} (${r.last_accessed})`),
    ];
    return lines.join("\n");
  }

  subscribe({ id, handler }: { id: string; handler: Handler }) {
    if (!this.handlers.has(id)) this.handlers.set(id, new Set());
    this.handlers.get(id)!.add(handler);
  }

  unsubscribe({ id, handler }: { id: string; handler: Handler }) {
    this.handlers.get(id)?.delete(handler);
  }
}
