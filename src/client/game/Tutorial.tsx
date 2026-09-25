"use client";
/**
 * Tutorial "Acordando dos destroços": guia passo a passo que reage ao estado real
 * (evento ativo, sangramento, painéis abertos) e destaca o elemento da interface
 * com o atributo data-tut-id correspondente. Progresso salvo no navegador.
 */
import { useEffect, useState } from "react";
import type { GameState } from "./useGame";

export interface TutCtx {
  state: GameState;
  panel: "char" | "bag" | null;
  selected: string | null;
}

interface Step {
  id: string;
  target?: string;
  title: string;
  text: (c: TutCtx) => string;
  skip?: (c: TutCtx) => boolean; // avaliado ao entrar na etapa
  until?: (c: TutCtx) => boolean; // avança sozinho quando verdadeiro
}

const bleeding = (c: TutCtx) => !!c.state.me?.wounds.some((w) => w.bleedingRate > 0);
const pendingIs = (c: TutCtx, t: string) => c.state.pending?.type === t;

const STEPS: Step[] = [
  {
    id: "intro", title: "Acordando dos destroços",
    text: () => "Você sobreviveu à queda. Agora precisa sobreviver ao vale. Toda ação gasta tempo de jogo — e o tempo cobra do corpo: sede, fome, frio e sono.",
  },
  {
    id: "clock", target: "clock", title: "O relógio",
    text: () => "Aqui está a hora no vale e a temperatura. À noite esfria rápido e coisas estranhas acontecem.",
  },
  {
    id: "event", target: "event", title: "Um evento",
    text: () => "Eventos pedem uma escolha. Cada opção custa minutos e pode exigir um teste de atributo. Escolha uma.",
    skip: (c) => !c.state.event?.participating,
    until: (c) => !c.state.event?.participating || !!c.state.pending,
  },
  {
    id: "wait", target: "pending", title: "O tempo passa",
    text: () => "Ações levam tempo real. Espere a barra encher — ou cancele se mudar de ideia.",
    skip: (c) => !c.state.pending,
    until: (c) => !c.state.pending,
  },
  {
    id: "body", target: "avatar", title: "Seu corpo",
    text: (c) => bleeding(c)
      ? "Você está sangrando — o boneco pisca em vermelho. Toque no seu personagem, agora."
      : "Toque no seu personagem para ver sinais vitais e ferimentos. Quando o boneco piscar, algo está errado.",
    until: (c) => c.panel === "char",
  },
  {
    id: "treat", target: "treat", title: "Estanque o sangue",
    text: (c) => c.panel === "char"
      ? "Toque em Tratar. A atadura do seu bolso estanca o sangramento."
      : "Abra o personagem e toque em Tratar no ferimento que sangra.",
    skip: (c) => !bleeding(c),
    until: (c) => !bleeding(c) || pendingIs(c, "tratar_ferimento"),
  },
  {
    id: "bag", target: "bag", title: "A mochila",
    text: (c) => c.panel === "bag"
      ? "Água e comida ficam aqui. Toque num item para beber, comer, vestir ou largar."
      : "Feche este painel e abra a Mochila. Beba e coma antes que sede e fome virem dano.",
    until: (c) => c.panel === "bag",
  },
  {
    id: "actions", target: "actions", title: "Ações do local",
    text: () => "Examinar revela pistas e caminhos. Procurar acha recursos. Lenha e fogo mantêm você vivo à noite.",
    skip: (c) => !c.state.here.actions.length,
  },
  {
    id: "map", target: "map", title: "O mapa",
    text: () => "Toque num local do mapa para ver o caminho e caminhar até lá. Examinar pode revelar trilhas escondidas.",
    until: (c) => !!c.selected || pendingIs(c, "mover"),
  },
  {
    id: "compass", target: "compass", title: "A saída",
    text: () => "A bússola aponta o próximo passo para sair do Vale Silente. Quando fica vermelha, é o seu corpo pedindo socorro primeiro. Boa sorte.",
  },
];

const KEY = "ls.tutorial.v1";

function load(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function save(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* sem armazenamento: o tutorial pode reaparecer */
  }
}

/** Abre de novo o tutorial (botão "?" do HUD). */
export function restartTutorial() {
  save("intro");
  window.dispatchEvent(new Event("ls-tutorial"));
}

export function Tutorial(ctx: TutCtx) {
  const [stepId, setStepId] = useState<string | null>(null); // null = ainda não lido; "done" = concluído

  useEffect(() => {
    const read = () => {
      const v = load();
      setStepId(v === "done" ? "done" : v && STEPS.some((s) => s.id === v) ? v : "intro");
    };
    read(); // localStorage só existe no cliente
    window.addEventListener("ls-tutorial", read);
    return () => window.removeEventListener("ls-tutorial", read);
  }, []);

  // Etapas que não se aplicam são puladas; as reativas avançam sozinhas.
  // O avanço é travado no estado (ajuste durante o render): fechar um painel não volta etapa.
  const stored = STEPS.findIndex((s) => s.id === stepId);
  let idx = stored;
  while (idx >= 0 && idx < STEPS.length && (STEPS[idx].skip?.(ctx) || STEPS[idx].until?.(ctx))) idx++;
  const nextId = stored < 0 ? stepId : idx < STEPS.length ? STEPS[idx].id : "done";
  if (nextId !== stepId) setStepId(nextId);

  useEffect(() => {
    if (stepId !== null) save(stepId);
  }, [stepId]);

  const go = (i: number) => setStepId(i < STEPS.length ? STEPS[i].id : "done");

  const step = stored >= 0 && idx < STEPS.length ? STEPS[idx] : null;

  // Destaque do alvo via atributo no body (alcança também gavetas e modais).
  const target = step?.target;
  useEffect(() => {
    if (target) document.body.dataset.tut = target;
    else delete document.body.dataset.tut;
    return () => {
      delete document.body.dataset.tut;
    };
  }, [target]);

  if (!step) return null;
  const manual = !step.until;

  return (
    <div className="tut" role="dialog" aria-live="polite" aria-label={`Tutorial: ${step.title}`}>
      <div className="tut-kicker">
        <span>Tutorial · {idx + 1}/{STEPS.length}</span>
        <button className="tut-skip" onClick={() => setStepId("done")}>Pular tutorial</button>
      </div>
      <strong className="tut-title">{step.title}</strong>
      <p className="tut-text">{step.text(ctx)}</p>
      {manual ? (
        <button className="btn btn-primary btn-sm" onClick={() => go(idx + 1)}>
          {idx === 0 ? "Começar" : idx === STEPS.length - 1 ? "Entendi" : "Próximo"}
        </button>
      ) : (
        <span className="tiny muted">Faça isso para continuar.</span>
      )}
    </div>
  );
}
