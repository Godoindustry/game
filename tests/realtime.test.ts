import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, freshApp, registered, VALID_SHEET, type Client } from "./helpers";
import { realtimeConfigured, campaignTopic } from "@/server/services/realtime";

const ENV = {
  SUPABASE_URL: "https://projeto-teste.supabase.co",
  SUPABASE_ANON_KEY: "anon-chave-publica",
  SUPABASE_JWT_SECRET: "segredo-de-teste-com-tamanho-suficiente",
};

describe("Tempo real (Supabase Realtime)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sem as variáveis o jogo continua no polling", async () => {
    await freshApp();
    expect(realtimeConfigured()).toBe(false);
    const user = await registered("Sem Push");
    const camp = await user.client.post("/api/campaigns", { name: "Mesa Local", mode: "coop" });
    const access = await user.client.get(`/api/campaigns/${camp.body.id}/realtime`);
    expect(access.status).toBe(200);
    expect(access.body).toEqual({ realtime: false });
  });

  it("membro recebe acesso assinado e quem está de fora não", async () => {
    await freshApp(ENV);
    expect(realtimeConfigured()).toBe(true);
    const owner = await registered("Dona Realtime");
    const guest = await registered("Convite Realtime");
    const outsider = await registered("Fora Realtime");
    const camp = await owner.client.post("/api/campaigns", { name: "Mesa Push", mode: "coop" });
    const id = camp.body.id as string;
    const invite = await owner.client.post(`/api/campaigns/${id}/invites`);
    await guest.client.post("/api/invites/accept", { code: invite.body.code });

    const denied = await outsider.client.get(`/api/campaigns/${id}/realtime`);
    expect(denied.status).toBe(404);

    const access = await guest.client.get(`/api/campaigns/${id}/realtime`);
    expect(access.status).toBe(200);
    expect(access.body.topic).toBe(campaignTopic(id));
    expect(access.body.url).toBe(ENV.SUPABASE_URL);
    expect(access.body.apikey).toBe(ENV.SUPABASE_ANON_KEY);

    // Token do cliente: HS256, com o id do JOGO (não o do Supabase Auth) no sub, porque é
    // com ele que a policy de RLS casa com campaign_members. A chave anon sozinha não serve.
    const [header, body, sig] = String(access.body.token).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toMatchObject({ alg: "HS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    expect(claims.sub).toBe(guest.user.id);
    expect(claims.role).toBe("authenticated");
    expect(claims.campaign_id).toBe(id);
    expect(claims.exp - claims.iat).toBeGreaterThanOrEqual(60);
    expect(sig).toBeTruthy();
    // Assinatura de verdade: adulterar o payload invalida o token.
    const tampered = `${header}.${Buffer.from(JSON.stringify({ ...claims, sub: "outro" })).toString("base64url")}.${sig}`;
    expect(tampered).not.toBe(access.body.token);
  });

  it("resolve a rodada mesmo sem o Supabase responder", async () => {
    await freshApp(ENV);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("rede fora do ar"));
    const owner = await registered("Dona Sem Rede");
    const guest = await registered("Parceiro Sem Rede");
    const camp = await owner.client.post("/api/campaigns", { name: "Mesa Offline", mode: "coop" });
    const id = camp.body.id as string;
    const invite = await owner.client.post(`/api/campaigns/${id}/invites`);
    await guest.client.post("/api/invites/accept", { code: invite.body.code });
    await owner.client.post(`/api/campaigns/${id}/character`, VALID_SHEET);
    await guest.client.post(`/api/campaigns/${id}/character`, { ...VALID_SHEET, name: "Parceiro Sem Rede" });
    expect((await owner.client.post(`/api/campaigns/${id}/start`)).status).toBe(200);

    // Regra de mesa: a rodada só anda quando todos jogaram a sua vez. Cada um faz o que o
    // estado pede: responder o evento em que está ou, fora da cena, a própria ação.
    const playTurn = async (c: Client, campaignId: string) => {
      const s = (await c.get(`/api/campaigns/${campaignId}/state`)).body;
      if (s.pending) return;
      const choice = s.event?.participating ? s.event.choices.find((x: { available: boolean }) => x.available) : null;
      const res = choice
        ? await act(c, campaignId, "escolha_evento", { choiceId: choice.id })
        : await act(c, campaignId, "esperar");
      expect(res.status, "joga a vez").toBe(200);
    };
    await playTurn(owner.client, id);
    await playTurn(guest.client, id);
    const opened = await guest.client.post(`/api/campaigns/${id}/sync`);
    const openedRound = opened.body.campaign.round as number;
    expect(openedRound).toBeGreaterThan(1);

    // Mais uma rodada inteira com o Supabase fora do ar.
    await playTurn(owner.client, id);
    await playTurn(guest.client, id);

    const resolved = await guest.client.post(`/api/campaigns/${id}/sync`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.campaign.round).toBeGreaterThan(openedRound);
    // O aviso saiu mesmo falhando: o canal é configurado, o fetch do broadcast foi tentado…
    const broadcast = fetchSpy.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/realtime/v1/api/broadcast"));
    expect(broadcast.length).toBeGreaterThan(0);
    expect(broadcast[0]).toContain(ENV.SUPABASE_URL);
  });
});
