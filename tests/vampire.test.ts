import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { applyEffects } from "@/server/engine/effects";
import { isNight, passTime } from "@/server/engine/physiology";
import { constantRng } from "@/server/engine/rng";
import { nightEncounter, ENCOUNTER_COOLDOWN_MINUTES } from "@/server/engine/vampire";
import { VALID_SHEET } from "./helpers";

function setup() {
  const v = validateCharacterSheet(VALID_SHEET);
  if (!v.ok) throw new Error(v.error);
  const world = initWorld(content, "camp-v", "seed-v");
  const char = initCharacter(content, randomUUID, { id: "char-v", userId: "user-v" }, v.sheet, v.finalAttributes);
  return { char, world };
}
// rng = 0.99 → nunca desvia (sempre é mordido); rng = 0 → sempre desvia
const bite = constantRng(0.99);

describe("Criaturas da noite", () => {
  it("o jogo começa à noite", () => {
    const { world } = setup();
    expect(isNight(content, world.minute)).toBe(true);
  });

  it("mordida fere o pescoço, dá a doença e respeita o intervalo entre ataques", () => {
    const { char, world } = setup();
    const r = nightEncounter(char, world, content, "morcego", bite, randomUUID);
    expect(r.happened && r.bitten).toBe(true);
    expect(char.health.diseases.find((d) => d.key === "mordida")?.level).toBe(1);
    expect(char.wounds.some((w) => w.bodyPart === "cabeca" && w.type === "laceracao")).toBe(true);
    // Logo em seguida: sem novo ataque
    expect(nightEncounter(char, world, content, "morcego", bite, randomUUID).reason).toBe("espera");
    world.minute += ENCOUNTER_COOLDOWN_MINUTES;
    expect(nightEncounter(char, world, content, "morcego", bite, randomUUID).bitten).toBe(true);
  });

  it("perto da fogueira acesa as criaturas não atacam", () => {
    const { char, world } = setup();
    applyEffects(char, [{ op: "fire", minutes: 120 }], {
      world, content, rng: constantRng(0), genId: randomUUID, minute: world.minute, lines: [], applied: [], extraMinutes: 0,
    });
    const r = nightEncounter(char, world, content, "morcego", bite, randomUUID);
    expect(r.happened).toBe(false);
    expect(r.reason).toBe("fogo");
  });

  it("de dia nada acontece", () => {
    const { char, world } = setup();
    world.minute += 10 * 60; // manhã seguinte
    expect(nightEncounter(char, world, content, "alma", bite, randomUUID).reason).toBe("dia");
  });

  it("quem desvia leva o susto, mas não a mordida", () => {
    const { char, world } = setup();
    const stress = char.status.stress;
    const r = nightEncounter(char, world, content, "morcego", constantRng(0), randomUUID);
    expect(r.happened).toBe(true);
    expect(r.bitten).toBe(false);
    expect(char.status.stress).toBeGreaterThan(stress);
  });

  it("três mordidas transformam o personagem", () => {
    const { char, world } = setup();
    for (let i = 0; i < 3; i++) {
      nightEncounter(char, world, content, "morcego", bite, randomUUID);
      world.minute += ENCOUNTER_COOLDOWN_MINUTES;
    }
    expect(char.alive).toBe(false);
    expect(char.deathCause).toMatch(/terceira vez/);
  });

  it("a mordida aumenta a sede (sede escura)", () => {
    const a = setup(), b = setup();
    nightEncounter(b.char, b.world, content, "morcego", bite, randomUUID);
    b.char.wounds = []; // isola o efeito da doença
    passTime(a.char, a.world, content, a.world.minute, 120, "rest");
    passTime(b.char, b.world, content, b.world.minute, 120, "rest");
    expect(b.char.status.thirst).toBeGreaterThan(a.char.status.thirst);
  });
});
