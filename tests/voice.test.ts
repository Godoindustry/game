import { beforeEach, describe, expect, it } from "vitest";
import { freshApp, registered } from "./helpers";

describe("Voz privada da campanha", () => {
  beforeEach(() => freshApp());

  it("só sinaliza entre membros da mesma sala", async () => {
    const owner = await registered("Voz Dona");
    const guest = await registered("Voz Convidado");
    const outsider = await registered("Voz Fora");
    const campaign = await owner.client.post("/api/campaigns", { name: "Mesa Fechada", mode: "coop" });
    const id = campaign.body.id as string;
    const invite = await owner.client.post(`/api/campaigns/${id}/invites`);
    await guest.client.post("/api/invites/accept", { code: invite.body.code });

    const denied = await outsider.client.post(`/api/campaigns/${id}/voice/exchange`, { active: true, signals: [] });
    expect(denied.status).toBe(404);

    const first = await owner.client.post(`/api/campaigns/${id}/voice/exchange`, { active: true, signals: [] });
    expect(first.body.peers).toEqual([]);
    const joined = await guest.client.post(`/api/campaigns/${id}/voice/exchange`, { active: true, signals: [] });
    expect(joined.body.peers).toEqual([{ id: owner.user.id, name: owner.user.displayName }]);

    await owner.client.post(`/api/campaigns/${id}/voice/exchange`, {
      active: true,
      signals: [{ to: guest.user.id, kind: "description", description: { type: "offer", sdp: "v=0\r\n" } }],
    });
    const polled = await guest.client.post(`/api/campaigns/${id}/voice/exchange`, { active: true, signals: [] });
    expect(polled.body.signals).toEqual([
      { from: owner.user.id, to: guest.user.id, kind: "description", description: { type: "offer", sdp: "v=0\r\n" } },
    ]);
  });
});
