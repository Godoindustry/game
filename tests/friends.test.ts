import { describe, it, expect, beforeEach } from "vitest";
import { Client, freshApp, registered, soloCampaign } from "./helpers";
import { getDb } from "@/server/db/database";

beforeEach(async () => {
  await freshApp();
});

async function pair() {
  const a = await registered("Alice");
  const b = await registered("Bruno");
  const codeB = (await b.client.get("/api/friends")).body.code as string;
  return { a, b, codeB };
}

describe("Amigos", () => {
  it("cada usuário tem um código estável no formato XXXX-XXXX", async () => {
    const a = await registered("Alice");
    const r1 = await a.client.get("/api/friends");
    const r2 = await a.client.get("/api/friends");
    expect(r1.status).toBe(200);
    expect(r1.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r2.body.code).toBe(r1.body.code);
  });

  it("pedido → aceitar → os dois se veem como amigos", async () => {
    const { a, b, codeB } = await pair();
    const sent = await a.client.post("/api/friends/requests", { code: codeB.toLowerCase().replace("-", " ") });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("pending");
    expect((await a.client.get("/api/friends")).body.outgoing).toHaveLength(1);
    const inc = (await b.client.get("/api/friends")).body.incoming;
    expect(inc).toHaveLength(1);
    expect(inc[0].displayName).toBe("Alice");
    // quem enviou não pode aceitar o próprio pedido
    expect((await a.client.post(`/api/friends/requests/${inc[0].id}`, { accept: true })).status).toBe(403);
    expect((await b.client.post(`/api/friends/requests/${inc[0].id}`, { accept: true })).status).toBe(200);
    expect((await a.client.get("/api/friends")).body.friends.map((f: { displayName: string }) => f.displayName)).toEqual(["Bruno"]);
    expect((await b.client.get("/api/friends")).body.friends).toHaveLength(1);
  });

  it("recusa, duplicado, próprio código e código inexistente", async () => {
    const { a, b, codeB } = await pair();
    await a.client.post("/api/friends/requests", { code: codeB });
    expect((await a.client.post("/api/friends/requests", { code: codeB })).status).toBe(409);
    const inc = (await b.client.get("/api/friends")).body.incoming;
    expect((await b.client.post(`/api/friends/requests/${inc[0].id}`, { accept: false })).status).toBe(200);
    expect((await a.client.get("/api/friends")).body.outgoing).toHaveLength(0);
    const codeA = (await a.client.get("/api/friends")).body.code;
    expect((await a.client.post("/api/friends/requests", { code: codeA })).status).toBe(400);
    expect((await a.client.post("/api/friends/requests", { code: "ZZZZ-ZZZZ" })).status).toBe(404);
    expect((await a.client.post("/api/friends/requests", { code: "abc" })).status).toBe(400);
  });

  it("pedidos cruzados viram amizade automaticamente", async () => {
    const { a, b, codeB } = await pair();
    const codeA = (await a.client.get("/api/friends")).body.code;
    await b.client.post("/api/friends/requests", { code: codeA });
    const r = await a.client.post("/api/friends/requests", { code: codeB });
    expect(r.body.status).toBe("accepted");
    expect((await a.client.get("/api/friends")).body.friends).toHaveLength(1);
    expect((await a.client.post("/api/friends/requests", { code: codeB })).status).toBe(409);
  });

  it("remover desfaz a amizade para os dois", async () => {
    const { a, b, codeB } = await pair();
    await a.client.post("/api/friends/requests", { code: codeB });
    const inc = (await b.client.get("/api/friends")).body.incoming;
    await b.client.post(`/api/friends/requests/${inc[0].id}`, { accept: true });
    expect((await b.client.del(`/api/friends/${a.user.id}`)).status).toBe(200);
    expect((await a.client.get("/api/friends")).body.friends).toHaveLength(0);
    expect((await b.client.del(`/api/friends/${a.user.id}`)).status).toBe(404);
  });
});

describe("Presença", () => {
  async function friends() {
    const { a, b, codeB } = await pair();
    await a.client.post("/api/friends/requests", { code: codeB });
    const inc = (await b.client.get("/api/friends")).body.incoming;
    await b.client.post(`/api/friends/requests/${inc[0].id}`, { accept: true });
    const bruno = async () => (await a.client.get("/api/friends")).body.friends[0];
    return { a, b, bruno };
  }

  it("offline até mandar heartbeat; depois mostra menu principal", async () => {
    const { b, bruno } = await friends();
    expect((await bruno()).online).toBe(false);
    expect((await b.client.post("/api/presence", { activity: "menu" })).status).toBe(200);
    const f = await bruno();
    expect(f.online).toBe(true);
    expect(f.activity).toBe("menu");
    expect(f.campaign).toBeNull();
  });

  it("em partida mostra a campanha; heartbeat antigo conta como offline", async () => {
    const { b, bruno } = await friends();
    const id = await soloCampaign(b.client);
    await b.client.post("/api/presence", { activity: "playing", campaignId: id });
    const f = await bruno();
    expect(f.activity).toBe("playing");
    expect(f.campaign.name).toBe("Teste Solo");
    await getDb().run("UPDATE user_presence SET last_seen_at = '2000-01-01T00:00:00.000Z'");
    expect((await bruno()).online).toBe(false);
  });

  it("não aparece em partida de campanha de que não é membro", async () => {
    const { a, b, bruno } = await friends();
    const alheia = await soloCampaign(a.client);
    await b.client.post("/api/presence", { activity: "playing", campaignId: alheia });
    const f = await bruno();
    expect(f.activity).toBe("menu");
    expect(f.campaign).toBeNull();
  });

  it("logout marca offline na hora", async () => {
    const { b, bruno } = await friends();
    await b.client.post("/api/presence", { activity: "menu" });
    await b.client.post("/api/auth/logout");
    expect((await bruno()).online).toBe(false);
  });

  it("exige login", async () => {
    const anon = new Client();
    expect((await anon.get("/api/friends")).status).toBe(401);
    expect((await anon.post("/api/presence", { activity: "menu" })).status).toBe(401);
  });
});
