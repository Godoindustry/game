/**
 * Camada de dados assíncrona com dois adaptadores:
 *  - PostgreSQL (Supabase/produção) quando DATABASE_URL está definido;
 *  - SQLite nativo (`node:sqlite`) para desenvolvimento local e testes.
 *
 * O SQL do app usa `?` como placeholder e sintaxe comum aos dois bancos
 * (ON CONFLICT … DO UPDATE/NOTHING, RETURNING). O adaptador PG converte para $1, $2…
 *
 * Transações: `db.tx(async () => …)`. Dentro dela, QUALQUER chamada a getDb() usa a
 * mesma conexão (AsyncLocalStorage) — funções chamadas dentro da transação não
 * precisam receber a conexão por parâmetro. Transações aninhadas viram SAVEPOINT.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | boolean | null | undefined;

interface Conn {
  query(sql: string, params: Param[]): Promise<{ rows: Row[]; changes: number }>;
}
interface TxConn extends Conn {
  depth: number;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
interface Driver extends Conn {
  kind: "sqlite" | "postgres";
  begin(): Promise<TxConn>;
  /** Script com várias instruções, sem parâmetros (migrações, TRUNCATE). */
  exec(script: string): Promise<void>;
  close(): Promise<void>;
}

const txStore = new AsyncLocalStorage<TxConn>();

// ---------- SQLite ----------
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }
}

const normalize = (p: Param[]) => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
const returnsRows = (sql: string) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

async function sqliteDriver(file: string): Promise<Driver> {
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const mutex = new Mutex();
  const execSync = (sql: string, params: Param[]) => {
    const values = normalize(params) as (string | number | bigint | null)[];
    const stmt = raw.prepare(sql);
    if (returnsRows(sql)) return { rows: stmt.all(...values) as Row[], changes: 0 };
    return { rows: [], changes: Number(stmt.run(...values).changes) };
  };
  return {
    kind: "sqlite",
    // Fora de transação: espera qualquer transação aberta terminar (evita intercalar).
    async query(sql, params) {
      const release = await mutex.acquire();
      try {
        return execSync(sql, params);
      } finally {
        release();
      }
    },
    async begin() {
      const release = await mutex.acquire();
      try {
        raw.exec("BEGIN IMMEDIATE");
      } catch (e) {
        release();
        throw e;
      }
      let done = false;
      const finish = (sql: string) => {
        if (done) return;
        done = true;
        try {
          raw.exec(sql);
        } finally {
          release();
        }
      };
      return {
        depth: 0,
        query: async (sql, params) => execSync(sql, params),
        commit: async () => finish("COMMIT"),
        rollback: async () => finish("ROLLBACK"),
      };
    },
    async exec(script) {
      const release = await mutex.acquire();
      try {
        raw.exec(script);
      } finally {
        release();
      }
    },
    async close() {
      raw.close();
    },
  };
}

// ---------- PostgreSQL ----------
/** Converte `?` em `$n`, ignorando `?` dentro de literais '…'. */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let inStr = false;
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    if (ch === "?" && !inStr) out += `$${++n}`;
    else out += ch;
  }
  return out;
}

async function postgresDriver(url: string, schema?: string): Promise<Driver> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  types.setTypeParser(20, (v: string) => parseInt(v, 10)); // int8 (COUNT, SUM) → number
  types.setTypeParser(1700, (v: string) => parseFloat(v)); // numeric → number
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  if (schema) {
    // Schema dedicado (ex.: testes isolados). Exige conexão de sessão (porta 5432), não o pooler transacional.
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("PG_SCHEMA inválido");
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    pool.on("connect", (client) => void client.query(`SET search_path TO ${schema}`));
  }
  const run = async (client: { query: (q: string, v: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }> }, sql: string, params: Param[]) => {
    const r = await client.query(toPgPlaceholders(sql), normalize(params).map((v) => (typeof v === "bigint" ? v.toString() : v)));
    return { rows: r.rows, changes: r.rowCount ?? 0 };
  };
  return {
    kind: "postgres",
    query: (sql, params) => run(pool, sql, params),
    async begin() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
      } catch (e) {
        client.release();
        throw e;
      }
      let done = false;
      const finish = async (sql: string) => {
        if (done) return;
        done = true;
        try {
          await client.query(sql);
        } finally {
          client.release();
        }
      };
      return {
        depth: 0,
        query: (sql, params) => run(client, sql, params),
        commit: () => finish("COMMIT"),
        rollback: () => finish("ROLLBACK"),
      };
    },
    async exec(script) {
      await pool.query(script);
    },
    close: () => pool.end(),
  };
}

// ---------- Fachada ----------
export class Db {
  constructor(private readonly driver: Driver) {}

  get kind() {
    return this.driver.kind;
  }

  private conn(): Conn {
    return txStore.getStore() ?? this.driver;
  }

  async all<T = Row>(sql: string, ...params: Param[]): Promise<T[]> {
    return (await this.conn().query(sql, params)).rows as T[];
  }

  async get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> {
    return (await this.all<T>(sql, ...params))[0];
  }

  async run(sql: string, ...params: Param[]): Promise<{ changes: number; rows: Row[] }> {
    return this.conn().query(sql, params);
  }

  /** Executa `fn` numa transação; tudo que usar getDb() dentro dela usa a mesma conexão. */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const current = txStore.getStore();
    if (current) {
      const sp = `sp_${++current.depth}`;
      await current.query(`SAVEPOINT ${sp}`, []);
      try {
        const r = await fn();
        await current.query(`RELEASE SAVEPOINT ${sp}`, []);
        return r;
      } catch (e) {
        await current.query(`ROLLBACK TO SAVEPOINT ${sp}`, []);
        throw e;
      }
    }
    const conn = await this.driver.begin();
    try {
      const r = await txStore.run(conn, fn);
      await conn.commit();
      return r;
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  }

  /**
   * Trava lógica até o fim da transação atual (serializa corridas: vagas premium,
   * entrada em campanha, resolução de rodada). No SQLite a transação já é exclusiva.
   */
  async lock(key: string): Promise<void> {
    if (this.driver.kind !== "postgres") return;
    if (!txStore.getStore()) throw new Error("lock() precisa estar dentro de tx()");
    await this.run("SELECT pg_advisory_xact_lock(hashtext(?))", key);
  }

  async exec(script: string): Promise<void> {
    await this.driver.exec(script);
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}

export async function openDb(opts: { url?: string; file?: string; schema?: string } = {}): Promise<Db> {
  const c = getConfig();
  const url = opts.url ?? (opts.file ? undefined : c.DATABASE_URL);
  if (!url && !opts.file && process.env.VERCEL) {
    // Na Vercel o disco é somente-leitura/efêmero: SQLite não funciona.
    throw new Error("DATABASE_URL não definida: na Vercel o banco precisa ser o Postgres do Supabase (Settings → Environment Variables → DATABASE_URL, depois Redeploy).");
  }
  if (url) {
    if (/\[YOUR-PASSWORD\]/i.test(url)) throw new Error("DATABASE_URL ainda tem [YOUR-PASSWORD]: troque pela senha real do banco.");
    try {
      new URL(url);
    } catch {
      throw new Error("DATABASE_URL mal formada: se a senha tiver @ : / # ?, redefina uma senha sem esses caracteres no Supabase.");
    }
  }
  return new Db(url ? await postgresDriver(url, opts.schema ?? process.env.PG_SCHEMA) : await sqliteDriver(opts.file ?? c.DATABASE_PATH));
}

type G = typeof globalThis & { __lsDb?: Db; __lsDbOpening?: Promise<Db> };

/** Conexão do processo (reaproveitada entre requisições e recargas do Next em dev). */
export function getDb(): Db {
  const db = (globalThis as G).__lsDb;
  if (!db) throw new Error("Banco não inicializado: chame initDb() antes (feito no boot da API).");
  return db;
}

export async function initDb(): Promise<Db> {
  const g = globalThis as G;
  if (g.__lsDb) return g.__lsDb;
  g.__lsDbOpening ??= openDb().then((db) => (g.__lsDb = db));
  return g.__lsDbOpening;
}

/** Testes: injeta um banco. */
export function setDb(db: Db | undefined): void {
  const g = globalThis as G;
  g.__lsDb = db;
  g.__lsDbOpening = undefined;
}

let lastIso = 0;
/** Timestamp ISO estritamente crescente no processo (ordenação estável de logs). */
export function nowIso(date?: Date): string {
  if (date) return date.toISOString();
  const t = Math.max(Date.now(), lastIso + 1);
  lastIso = t;
  return new Date(t).toISOString();
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
