"use client";
/**
 * Ficha sobrenatural compacta: arte da linhagem, classe, recurso, disciplinas,
 * perdição e compulsão. As regras e a disponibilidade continuam no servidor.
 */
import { useState } from "react";
import type { GameState } from "./useGame";

type Me = NonNullable<GameState["me"]>;

const ATTR_LABEL: Record<string, string> = {
  forca: "força",
  resistencia: "resistência",
  agilidade: "agilidade",
  percepcao: "percepção",
  inteligencia: "inteligência",
  controle_emocional: "controle emocional",
  medicina: "medicina",
  orientacao: "orientação",
  comunicacao: "comunicação",
  furtividade: "furtividade",
  improviso: "improviso",
  conhecimento_tecnico: "conhecimento técnico",
};

const SIGIL: Record<string, string> = {
  human: "◇",
  vampire: "V",
  werewolf: "W",
  haunted: "†",
  hunter: "⌖",
};

function AwakeningCard({ mode }: { mode: "human" | "class" }) {
  return (
    <section className={`awakening-card awakening-${mode}`} aria-label="Despertar sobrenatural">
      <div className="awakening-ring" aria-hidden="true"><i /><i /><i /></div>
      <div>
        <span>{mode === "human" ? "ATO I · AINDA HUMANO" : "A LINHAGEM DESPERTOU"}</span>
        <strong>{mode === "human" ? "Algo já sabe o seu nome" : "Escolha o que restará de você"}</strong>
        <p>{mode === "human"
          ? "Na primeira noite, o vale vai abrir uma porta dentro de você. Sobreviva até descobrir quem está batendo do outro lado."
          : "Sangue, lua, mortos ou fé: seu novo caminho surgirá na próxima decisão narrativa."}</p>
      </div>
      <div className="awakening-signs" aria-hidden="true"><b>V</b><b>W</b><b>†</b><b>⌖</b></div>
    </section>
  );
}

export function PowerCard({ me, acts, busy, onAct }: {
  me: Me;
  acts: GameState["acts"];
  busy: boolean;
  onAct: (type: string, params?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = me.power;

  if (p.lineage === "human") return <AwakeningCard mode="human" />;
  if (!p.classId) return <AwakeningCard mode="class" />;

  const resourceDanger = p.resource >= p.resourceMax - 1;
  const pips = Array.from({ length: p.resourceMax }, (_, index) => index < p.resource);

  return (
    <section className={`power-card power-${p.lineage} ${resourceDanger ? "power-danger" : ""}`}>
      <div className="power-hero">
        <div className="power-hero-art" aria-hidden="true" />
        <div className="power-hero-shade" aria-hidden="true" />
        <div className="power-sigil" aria-hidden="true">{SIGIL[p.lineage] ?? "◇"}</div>
        <div className="power-identity">
          <span>{p.lineageLabel}</span>
          <strong>{p.className}</strong>
          <em>{p.epithets}</em>
        </div>
        <div className="power-resource" title={`${p.resourceName}: no máximo, a compulsão acontece`}>
          <span>{p.resourceName}</span>
          <strong>{p.resource}<small>/{p.resourceMax}</small></strong>
          <div aria-label={`${p.resourceName} ${p.resource} de ${p.resourceMax}`}>
            {pips.map((filled, index) => <i key={index} className={filled ? "filled" : ""} />)}
          </div>
        </div>
      </div>

      {(p.buffs.length > 0 || p.wardMinutesLeft > 0) && (
        <div className="power-effects" aria-label="Efeitos ativos">
          {p.buffs.map((buff, index) => (
            <span key={`${buff.attr}-${index}`}><b>+{buff.bonus}%</b> {ATTR_LABEL[buff.attr] ?? buff.attr}<small>{buff.minutesLeft} min</small></span>
          ))}
          {p.wardMinutesLeft > 0 && <span className="warded"><b>PROTEGIDO</b> criaturas afastadas<small>{p.wardMinutesLeft} min</small></span>}
        </div>
      )}

      <div className="power-actions" aria-label="Disciplinas e ações da classe">
        {p.actions.map((action, index) => {
          const powerId = (action.params as { power?: string }).power;
          const definition = p.powers.find((power) => power.id === powerId);
          return (
            <button
              key={`${action.type}-${powerId ?? index}`}
              type="button"
              disabled={busy || !action.available}
              title={action.reason ?? definition?.description}
              onClick={() => onAct(action.type, action.params)}
            >
              <span className="power-action-mark" aria-hidden="true">{definition ? "✦" : "⌁"}</span>
              <span className="power-action-copy">
                <b>{action.label}</b>
                <small>{definition?.description ?? action.reason ?? "Instinto predador"}</small>
              </span>
              <span className="power-action-cost">
                {definition ? <><b>+{definition.cost}</b><small>{p.resourceName}{definition.onlyNight ? " · noite" : ""}</small></> : <small>{action.available ? "45 min" : action.reason}</small>}
              </span>
            </button>
          );
        })}
      </div>

      <button className="power-lore-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{open ? "Fechar grimório" : "Abrir grimório da classe"}</span><i aria-hidden="true">{open ? "−" : "+"}</i>
      </button>

      {open && (
        <div className="power-lore">
          <p>{p.description}</p>
          <article className="power-lore-passive"><span>DOM PASSIVO</span><b>{p.passive?.name}</b><small>{p.passive?.description}</small></article>
          {p.powers.map((power) => <article key={power.id}><span>DISCIPLINA</span><b>{power.name}</b><small>{power.description}</small></article>)}
          <article className="power-lore-bane"><span>PERDIÇÃO</span><b>{p.bane?.name}</b><small>{p.bane?.description}</small></article>
          <article className="power-lore-compulsion"><span>COMPULSÃO</span><b>{p.compulsion?.name}</b><small>{p.compulsion?.description}</small></article>
        </div>
      )}

      {!acts.reunited && (
        <div className="power-act-warning">
          <i aria-hidden="true" />
          {acts.allAwakened ? "Todos despertaram. Reúnam-se no acampamento abandonado." : "Os outros ainda estão mudando. Sobreviva até o chamado."}
        </div>
      )}
    </section>
  );
}
