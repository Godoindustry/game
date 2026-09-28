import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import path from "node:path";
import { AVATAR_IDS, CLASSIC_AVATARS, CREATURE_AVATARS, SPRITE, avatarName } from "@/shared/avatars";
import { freshApp, registered } from "./helpers";

describe("Ícones de perfil", () => {
  it("112 criaturas, uma por posição do sprite, com nomes únicos", async () => {
    expect(CREATURE_AVATARS).toHaveLength(SPRITE.cols * SPRITE.rows);
    expect(new Set(CREATURE_AVATARS.map((a) => a.name)).size).toBe(CREATURE_AVATARS.length);
    expect(new Set(AVATAR_IDS).size).toBe(AVATAR_IDS.length);
    const meta = await sharp(path.join(process.cwd(), "public", SPRITE.url)).metadata();
    expect([meta.width, meta.height]).toEqual([SPRITE.cols * SPRITE.size, SPRITE.rows * SPRITE.size]);
  });

  it("os clássicos continuam válidos e têm nome legível", () => {
    for (const id of CLASSIC_AVATARS) expect(AVATAR_IDS).toContain(id);
    expect(avatarName("bussola")).toBe("Bússola");
    expect(avatarName("criatura-001")).toBe("Olho Tirano");
  });

  describe("perfil", () => {
    beforeEach(async () => {
      await freshApp();
    });

    it("salva uma criatura e recusa ícone que não existe", async () => {
      const a = await registered("Avatar");
      const ok = await a.client.patch("/api/profile", { avatar: "criatura-052" });
      expect(ok.status).toBe(200);
      expect(ok.body.avatar).toBe("criatura-052");
      expect((await a.client.patch("/api/profile", { avatar: "criatura-999" })).status).toBe(400);
    });
  });
});
