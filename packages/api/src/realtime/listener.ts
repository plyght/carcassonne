// One direct Postgres connection per instance, LISTENing on `game_<id>` only for games that have local
// sockets (PRD §7.3 step 5). Must use the unpooled URL: LISTEN does not work through a transaction pooler.
import pg from "pg";

type Handler = (payload: string) => void;

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

export class PgListener {
  private client: pg.Client | null = null;
  private connecting: Promise<pg.Client> | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;

  constructor(private readonly connectionString: string) {}

  private async connect(): Promise<pg.Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const c = new pg.Client({ connectionString: this.connectionString, keepAlive: true });
      c.on("notification", (msg) => {
        for (const h of this.handlers.get(msg.channel) ?? []) {
          try {
            h(msg.payload ?? "");
          } catch (err) {
            console.error("[listener] handler error", err);
          }
        }
      });
      c.on("error", (err) => {
        console.error("[listener] connection error, reconnecting", err.message);
        this.client = null;
        void c.end().catch(() => {});
        if (!this.closed && this.handlers.size > 0) void this.resubscribe();
      });
      await c.connect();
      this.client = c;
      return c;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async resubscribe() {
    await new Promise((r) => setTimeout(r, 500));
    const c = await this.connect();
    for (const ch of this.handlers.keys()) await c.query(`LISTEN ${quoteIdent(ch)}`);
  }

  /** Subscribe; resolves once LISTEN is active. Returns an unsubscribe function. */
  async listen(channel: string, handler: Handler): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    const first = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    if (first) {
      const c = await this.connect();
      await c.query(`LISTEN ${quoteIdent(channel)}`);
    }
    return async () => {
      const s = this.handlers.get(channel);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(channel);
        if (this.client) await this.client.query(`UNLISTEN ${quoteIdent(channel)}`).catch(() => {});
      }
    };
  }

  channels() {
    return [...this.handlers.keys()];
  }

  async close() {
    this.closed = true;
    this.handlers.clear();
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => {});
  }
}
