import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { VALE_SILENTE as content } from "@/server/content/valeSilente";
import { campaignStory } from "@/server/engine/story";
import { initCharacter, initWorld } from "@/server/engine/setup";
import { validateCharacterSheet } from "@/server/engine/character";
import { meetsRequirements } from "@/server/engine/effects";
import type { CharacterState, WorldState } from "@/server/engine/types";
import { VALID_SHEET } from "./helpers";

function setup(): { char: CharacterState; world: WorldState } {
  const sheet = validateCharacterSheet(VALID_SHEET);
  if (!sheet.ok) throw new Error(sheet.error);
  const world = initWorld(content, "story-campaign", "story-seed");
  const char = initCharacter(content, randomUUID, { id: "story-char", userId: "story-user" }, sheet.sheet, sheet.finalAttributes);
  return { char, world };
}

describe("Campanha longa — atos, mapas e chefes", () => {
  it("declara uma sessão de 90–130 minutos dividida em quatro atos contínuos", () => {
    expect(content.targetRealMinutes).toEqual([90, 130]);
    expect(content.acts).toHaveLength(4);
    expect(content.acts?.map((act) => act.targetRealMinutes)).toEqual([[0, 20], [20, 55], [55, 90], [90, 130]]);
    expect(content.regions).toHaveLength(4);
    expect(content.bosses?.map((boss) => boss.id)).toEqual(["mae", "ambar", "tavares", "iara"]);
  });

  it("avança pelos atos apenas por decisões da história — esperar não pula conteúdo", () => {
    const { world } = setup();
    expect(campaignStory(world, content, null).phase?.id).toBe("queda");

    world.minute = 10_000;
    expect(campaignStory(world, content, null).phase?.id).toBe("queda");

    world.flags.bagageiro_aberto = true;
    world.locations.mata.visited = true;
    expect(campaignStory(world, content, null).phase?.id).toBe("caca");

    world.flags.ambar_aliado = true;
    world.flags.encontro_feito = true;
    expect(campaignStory(world, content, null).phase?.id).toBe("rumo");

    world.flags.tavares_resolvido = true;
    expect(campaignStory(world, content, null).phase?.id).toBe("voz");
  });

  it("apresenta o chefe ativo e acompanha seus estágios sem inventar pontos de vida", () => {
    const { world } = setup();
    world.flags.rastro_ambar = true;
    const hunting = campaignStory(world, content, "ch_ambar").boss!;
    expect(hunting).toMatchObject({ id: "ambar", active: true, stage: 1, resolved: false });

    world.flags.ambar_ferido = true;
    expect(campaignStory(world, content, "ch_ambar_final").boss).toMatchObject({ id: "ambar", stage: 2 });

    world.flags.ambar_aliado = true;
    expect(campaignStory(world, content, null).boss).toMatchObject({ id: "ambar", stage: 3, resolved: true });
  });

  it("bloqueia rádio e resgate até Tavares, Iara e o Observatório 740", () => {
    const { char, world } = setup();
    const radio = content.events.find((event) => event.id === "vs_radio_final")!;
    const rescue = content.events.find((event) => event.id === "vs_resgate")!;
    const finishChoices = [
      radio.choices.find((choice) => choice.id === "vs_radio_final.ligar")!,
      rescue.choices.find((choice) => choice.id === "vs_resgate.sinalizador")!,
    ];

    for (const choice of finishChoices) expect(meetsRequirements(char, world, content, choice.requirements).ok).toBe(false);

    world.flags.tavares_resolvido = true;
    world.flags.iara_em_paz = true;
    world.flags.sinal_final_alinhado = true;
    char.inventory.push({ id: "flare", itemId: "sinalizador", container: "hands", quantity: 1, durability: null, battery: null, usesLeft: null, wetness: 0, contaminated: false });
    for (const choice of finishChoices) expect(meetsRequirements(char, world, content, choice.requirements).ok).toBe(true);
  });

  it("mantém todas as regiões ligadas e seus locais válidos", () => {
    const regionLocations = new Set(content.regions?.flatMap((region) => region.locationIds));
    for (const id of ["cemiterio", "capela", "galeria", "observatorio"]) {
      expect(content.locations[id], id).toBeTruthy();
      expect(regionLocations.has(id), `${id} sem mapa regional`).toBe(true);
    }
    for (const link of content.links) {
      expect(content.locations[link.from], link.from).toBeTruthy();
      expect(content.locations[link.to], link.to).toBeTruthy();
    }
  });
});
