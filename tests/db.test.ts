import { describe, it, expect, beforeEach } from "vitest";
import { freshApp, Client, registered, VALID_SHEET } from "./helpers";
import { getDb, toPgPlaceholders } from "@/server/db/database";
import { schemaForPostgres, schemaTables } from "@/server/db/schema";

beforeEach(async () => {
  await freshApp();
});

describe("Camada de dados", () => {
  it("converte placeholders para Postgres sem mexer em literais", () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2");
  });

  it("schema Postgres: sem sintaxe SQLite e com RLS em todas as tabelas", () => {
    const sql = schemaForPostgres();
    expect(sql).not.toMatch(/COLLATE NOCASE|AUTOINCREMENT|PRAGMA/);
    expect(sql).not.toMatch(/\bREAL\b/);
    for (const t of schemaTables()) expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
    expect(schemaTables()).toContain("rate_limits");
  });

  it("transações concorrentes não se intercalam (ler-modificar-gravar)", async () => {
    const db = getDb();
    await db.run("INSERT INTO schema_meta(key, value) VALUES('contador', '0') ON CONFLICT(key) DO UPDATE SET value = '0'");
    await Promise.all(
      Array.from({ length: 10 }, () =>
        db.tx(async () => {
          await db.lock("contador");
          const r = await db.get<{ value: string }>("SELECT value FROM schema_meta WHERE key = 'contador'");
          await new Promise((res) => setTimeout(res, 2)); // força intercalação se não houver isolamento
          await db.run("UPDATE schema_meta SET value = ? WHERE key = 'contador'", String(Number(r!.value) + 1));
        }),
      ),
    );
    expect((await db.get<{ value: string }>("SELECT value FROM schema_meta WHERE key = 'contador'"))!.value).toBe("10");
  });

  it("rollback desfaz tudo quando a transação falha", async () => {
    const db = getDb();
    await expect(
      db.tx(async () => {
        await db.run("INSERT INTO schema_meta(key, value) VALUES('temporario', 'x')");
        throw new Error("falha proposital");
      }),
    ).rejects.toThrow("falha proposital");
    expect(await db.get("SELECT 1 FROM schema_meta WHERE key = 'temporario'")).toBeUndefined();
  });
});

describe("Corridas reais pela API", () => {
  it("20 cadastros simultâneos → exatamente 12 vagas premium, sem repetir número", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        new Client(`10.50.0.${i}`).post("/api/auth/register", { email: `corrida${i}@teste.local`, password: "Senha1234", displayName: `Corrida ${i}` }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.user.premium)).toHaveLength(12);
    const slots = await getDb().all<{ slot_number: number }>("SELECT slot_number FROM premium_status WHERE slot_number IS NOT NULL ORDER BY slot_number");
    expect(slots.map((s) => s.slot_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("6 jogadores aceitando convite ao mesmo tempo → campanha fica com exatamente 4", async () => {
    const owner = await registered("Dona Corrida");
    const c = await owner.client.post("/api/campaigns", { name: "Corrida", mode: "coop" });
    const inv = await owner.client.post(`/api/campaigns/${c.body.id}/invites`);
    const inv2 = await owner.client.post(`/api/campaigns/${c.body.id}/invites`);
    const guests = await Promise.all(Array.from({ length: 6 }, (_, i) => registered(`Convidado ${i}`)));
    const res = await Promise.all(guests.map((g, i) => g.client.post("/api/invites/accept", { code: i % 2 ? inv.body.code : inv2.body.code })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(3);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
    const n = await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_members WHERE campaign_id = ?", c.body.id);
    expect(Number(n!.n)).toBe(4);
  });

  it("dois syncs simultâneos resolvem a rodada uma única vez", async () => {
    const { client } = await registered("Sync Duplo");
    const c = await client.post("/api/campaigns", { name: "Sync", mode: "solo" });
    await client.post(`/api/campaigns/${c.body.id}/character`, VALID_SHEET);
    await client.post(`/api/campaigns/${c.body.id}/start`);
    // envia com espera (não resolve na hora) e dispara vários syncs juntos depois
    const { setConfig, getConfig } = await import("@/server/config");
    setConfig({ ...getConfig(), ACTION_REAL_SECONDS_PER_GAME_MINUTE: 0.01, ACTION_MAX_REAL_SECONDS: 1 });
    await client.post(`/api/campaigns/${c.body.id}/actions`, { type: "escolha_evento", params: { choiceId: "vs_despertar.gritar" }, idempotencyKey: "corrida-sync-1" });
    await new Promise((r) => setTimeout(r, 120));
    const syncs = await Promise.all(Array.from({ length: 5 }, () => client.post(`/api/campaigns/${c.body.id}/sync`)));
    expect(syncs.every((s) => s.status === 200)).toBe(true);
    const camp = await getDb().get<{ current_round: number; game_minutes: number }>("SELECT current_round, game_minutes FROM campaigns WHERE id = ?", c.body.id);
    expect(Number(camp!.current_round)).toBe(2); // não 3, 4…
    expect(Number(camp!.game_minutes)).toBe(3);
    const resolutions = await getDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM action_resolutions WHERE campaign_id = ?", c.body.id);
    expect(Number(resolutions!.n)).toBe(1);
  });
});

describe("Falhas de inicialização viram mensagem clara (sem segredos)", () => {
  it("Vercel sem DATABASE_URL responde 503 JSON explicando o que falta", async () => {
    const { resetApiForTests, handleApi } = await import("@/server/http/api");
    const { setDb } = await import("@/server/db/database");
    process.env.VERCEL = "1";
    try {
      setDb(undefined);
      resetApiForTests();
      const res = await handleApi(new Request("http://localhost:3000/api/meta"));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/DATABASE_URL não definida/);
    } finally {
      delete process.env.VERCEL;
    }
  });
  it("DATABASE_URL com senha de exemplo ou mal formada é explicada", async () => {
    const { openDb } = await import("@/server/db/database");
    await expect(openDb({ url: "postgresql://postgres.x:[YOUR-PASSWORD]@h:6543/postgres" })).rejects.toThrow(/YOUR-PASSWORD/);
    await expect(openDb({ url: "não é url" })).rejects.toThrow(/mal formada/);
  });
});
