/**
 * Utilitários de teste: banco novo por teste + cliente HTTP com cookies e CSRF.
 *
 * Padrão: SQLite em memória. Com TEST_DATABASE_URL (Postgres, conexão de SESSÃO — porta 5432),
 * a mesma suíte roda no schema isolado `ls_test` (as tabelas de jogo são limpas entre testes;
 * o schema `public` de produção nunca é tocado).
 */
import { type Db, openDb, setDb } from "@/server/db/database";
import { schemaTables } from "@/server/db/schema";
import { setConfig, type AppConfig } from "@/server/config";
import { handleApi, resetApiForTests } from "@/server/http/api";
import { setProvider } from "@/server/ai/service";
import { MockProvider } from "@/server/ai/providers/mock";
import { bootDatabase } from "@/server/db/seed";

export const BASE = "http://localhost:3000";
const PG_URL = process.env.TEST_DATABASE_URL;
const CATALOG = new Set(["schema_meta", "items", "clothing", "locations", "location_links", "events", "event_choices", "achievements"]);
let pgDb: Db | null = null;
let current: Db | null = null;

export async function freshApp(overrides: Partial<AppConfig> = {}, file = ":memory:"): Promise<Db> {
  setConfig({
    NODE_ENV: "test",
    APP_URL: BASE,
    DATABASE_PATH: file,
    DATABASE_URL: undefined,
    ACTION_REAL_SECONDS_PER_GAME_MINUTE: 0,
    ACTION_MAX_REAL_SECONDS: 0,
    ADMIN_EMAIL: "master@teste.local",
    ADMIN_PASSWORD: "Master12345",
    FIXED_SEED: "seed-teste",
    AI_PROVIDER: "mock",
    ...overrides,
  });
  let db: Db;
  if (PG_URL && file === ":memory:") {
    pgDb ??= await openDb({ url: PG_URL, schema: "ls_test" });
    db = pgDb;
    setDb(db);
    await bootDatabase(db); // migra/semeia só na primeira vez (versão e hash)
    const tables = schemaTables().filter((t) => !CATALOG.has(t));
    await db.exec(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
  } else {
    if (current && current !== pgDb) await current.close().catch(() => undefined);
    db = await openDb({ file });
    setDb(db);
    await bootDatabase(db);
  }
  current = db;
  resetApiForTests();
  setProvider(new MockProvider());
  return db;
}

export class Client {
  cookies: Record<string, string> = {};
  constructor(public ip = "10.0.0.1") {}

  async request(method: string, path: string, body?: unknown, opts: { csrf?: boolean; origin?: string } = {}) {
    if (method !== "GET" && opts.csrf !== false && !this.cookies.ls_csrf) await this.request("GET", "/api/auth/csrf");
    const headers: Record<string, string> = { "x-forwarded-for": this.ip };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && opts.csrf !== false) headers["x-csrf-token"] = this.cookies.ls_csrf;
    if (opts.origin) headers.origin = opts.origin;
    const res = await handleApi(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i);
      const v = decodeURIComponent(pair.slice(i + 1));
      if (/Max-Age=0/.test(sc)) delete this.cookies[k];
      else this.cookies[k] = v;
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
  get = (p: string) => this.request("GET", p);
  post = (p: string, b?: unknown) => this.request("POST", p, b ?? {});
  patch = (p: string, b?: unknown) => this.request("PATCH", p, b ?? {});
  del = (p: string) => this.request("DELETE", p);
}

let counter = 0;
export async function registered(name = "Jogador", ip?: string) {
  const c = new Client(ip ?? `10.1.${Math.floor(counter / 200)}.${counter % 200}`);
  counter++;
  const email = `${name.toLowerCase().replace(/\W/g, "")}${counter}@teste.local`;
  const r = await c.post("/api/auth/register", { email, password: "Senha1234", displayName: name });
  if (r.status !== 200) throw new Error(`registro falhou: ${JSON.stringify(r.body)}`);
  return { client: c, user: r.body.user, email };
}

export const VALID_SHEET = {
  name: "Ana Ribeiro",
  age: 32,
  heightCm: 168,
  weightKg: 62,
  bodyType: "medio",
  conditioning: "moderado",
  profession: "enfermagem",
  knowledge: "Primeiros socorros",
  fears: "Escuro",
  history: "Voltava de um plantão.",
  personality: "Calma",
  experiences: ["medicina"],
  attributes: {
    forca: 3, resistencia: 3, agilidade: 3, percepcao: 3, inteligencia: 3, controle_emocional: 3,
    medicina: 3, orientacao: 3, comunicacao: 3, furtividade: 3, improviso: 3, conhecimento_tecnico: 3,
  },
};

/** Cria campanha solo com personagem e inicia. */
export async function soloCampaign(client: Client, sheet: Record<string, unknown> = VALID_SHEET) {
  const c = await client.post("/api/campaigns", { name: "Teste Solo", mode: "solo" });
  const id = c.body.id as string;
  const ch = await client.post(`/api/campaigns/${id}/character`, sheet);
  if (ch.status !== 200) throw new Error(JSON.stringify(ch.body));
  const st = await client.post(`/api/campaigns/${id}/start`);
  if (st.status !== 200) throw new Error(JSON.stringify(st.body));
  return id;
}

let keyN = 0;
export const key = () => `k${Date.now().toString(36)}${(keyN++).toString(36)}xx`;

export async function act(client: Client, id: string, type: string, params: Record<string, unknown> = {}) {
  return client.post(`/api/campaigns/${id}/actions`, { type, params, idempotencyKey: key() });
}
