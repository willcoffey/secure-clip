export type Handler = (args: { id: string; ciphertext: string }) => void;

export class Service {
  private handlers = new Map<string, Set<Handler>>();

  constructor(private sql: SqlStorage) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL
      )
    `);
  }

  async update({ id, ciphertext }: { id: string; ciphertext: string }) {
    if (ciphertext.length >= 131072) throw new Error("too large");
    this.sql.exec(
      `INSERT INTO clips (id, ciphertext) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext`,
      id,
      ciphertext,
    );
    for (const handler of this.handlers.get(id) ?? []) {
      handler({ id, ciphertext });
    }
  }

  async load({ id }: { id: string }): Promise<string | null> {
    const rows = this.sql.exec<{ ciphertext: string }>(
      `SELECT ciphertext FROM clips WHERE id = ?`,
      id,
    ).toArray();
    return rows[0]?.ciphertext ?? null;
  }

  subscribe({ id, handler }: { id: string; handler: Handler }) {
    if (!this.handlers.has(id)) this.handlers.set(id, new Set());
    this.handlers.get(id)!.add(handler);
  }

  unsubscribe({ id, handler }: { id: string; handler: Handler }) {
    this.handlers.get(id)?.delete(handler);
  }
}
