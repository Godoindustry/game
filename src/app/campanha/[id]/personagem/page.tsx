"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";
import { toastError } from "@/client/session";
import { ATTR_LABEL, BODY_LABEL, COND_LABEL, EXP_LABEL } from "@/client/labels";

interface Options {
  attributes: string[];
  professions: { id: string; label: string; bonus: string | null }[];
  bodyTypes: string[];
  conditionings: string[];
  experiences: string[];
  points: number;
  min: number;
  max: number;
  maxExperiences: number;
}

function CharacterForm() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [opt, setOpt] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({
    name: "", age: 30, heightCm: 170, weightKg: 70, bodyType: "medio", conditioning: "moderado", profession: "estudante",
    knowledge: "", fears: "", history: "", personality: "", experiences: [] as string[],
  });
  const [attrs, setAttrs] = useState<Record<string, number>>({});

  useEffect(() => {
    api<Options>("GET", "/api/meta/character-options").then((o) => {
      setOpt(o);
      setAttrs(Object.fromEntries(o.attributes.map((a) => [a, o.min])));
    }).catch(toastError);
    api<{ status: string; members: { isMe: boolean; hasCharacter: boolean }[] }>("GET", `/api/campaigns/${id}/lobby`).then((l) => {
      if (l.status !== "lobby" || l.members.find((m) => m.isMe)?.hasCharacter) router.replace(`/campanha/${id}/${l.status === "lobby" ? "lobby" : "jogar"}`);
    }).catch(toastError);
  }, [id, router]);

  const spent = useMemo(() => (opt ? Object.values(attrs).reduce((s, v) => s + (v - opt.min), 0) : 0), [attrs, opt]);
  if (!opt) return <Spinner />;
  const left = opt.points - spent;
  const bonus = opt.professions.find((p) => p.id === f.profession)?.bonus;

  const set = (k: string, v: number) => {
    if (v < opt.min || v > opt.max) return;
    if (v > attrs[k] && left <= 0) return;
    setAttrs({ ...attrs, [k]: v });
  };
  const toggleExp = (e: string) =>
    setF({ ...f, experiences: f.experiences.includes(e) ? f.experiences.filter((x) => x !== e) : f.experiences.length < opt.maxExperiences ? [...f.experiences, e] : f.experiences });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", `/api/campaigns/${id}/character`, { ...f, attributes: attrs });
      router.push(`/campanha/${id}/lobby`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) router.push(`/campanha/${id}/lobby`);
      setError(err instanceof Error ? err.message : "Erro");
      setBusy(false);
    }
  }

  const num = (k: "age" | "heightCm" | "weightKg", label: string, min: number, max: number, unit: string) => (
    <label className="field">
      <span className="label">{label} <span className="faint">({unit})</span></span>
      <input className="input mono" type="number" min={min} max={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
    </label>
  );
  const sel = (k: "bodyType" | "conditioning" | "profession", label: string, options: [string, string][]) => (
    <label className="field">
      <span className="label">{label}</span>
      <select className="select" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const txt = (k: "knowledge" | "fears" | "history" | "personality", label: string, ph: string) => (
    <label className="field">
      <span className="label">{label}</span>
      <textarea className="textarea" maxLength={k === "history" ? 600 : 300} placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );

  return (
    <form className="stack-lg" onSubmit={submit}>
      <div>
        <p className="label amber" style={{ marginBottom: 4 }}>Ficha do sobrevivente</p>
        <h1 className="h1" style={{ fontSize: 40 }}>Quem estava naquele avião?</h1>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="grid-2">
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Identidade</span></div>
          <label className="field">
            <span className="label">Nome</span>
            <input className="input" maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Ana Ribeiro" />
          </label>
          <div className="grid-3" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
            {num("age", "Idade", 18, 80, "anos")}
            {num("heightCm", "Altura", 140, 210, "cm")}
            {num("weightKg", "Peso", 40, 160, "kg")}
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {sel("bodyType", "Tipo físico", opt.bodyTypes.map((b) => [b, BODY_LABEL[b] ?? b]))}
            {sel("conditioning", "Condicionamento", opt.conditionings.map((c) => [c, COND_LABEL[c] ?? c]))}
          </div>
          {sel("profession", "Profissão", opt.professions.map((p) => [p.id, `${p.label}${p.bonus ? ` (+1 ${ATTR_LABEL[p.bonus].label})` : ""}`]))}
          <div className="field">
            <span className="label">Experiência prática (até {opt.maxExperiences})</span>
            <div className="row">
              {opt.experiences.map((e) => (
                <button type="button" key={e} onClick={() => toggleExp(e)} aria-pressed={f.experiences.includes(e)} className={`btn btn-sm ${f.experiences.includes(e) ? "btn-primary" : ""}`}>
                  {EXP_LABEL[e] ?? e}
                </button>
              ))}
            </div>
            <span className="hint">Experiência dá +15% nos testes relacionados.</span>
          </div>
        </section>
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Histórico</span></div>
          {txt("knowledge", "Conhecimentos", "O que você sabe fazer?")}
          {txt("fears", "Medos", "Do que você tem medo?")}
          {txt("history", "História", "Por que estava nesse voo?")}
          {txt("personality", "Personalidade", "Como reage sob pressão?")}
        </section>
      </div>
      <section className="panel stack">
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <span className="h2">Atributos</span>
          <span className={`chip mono ${left === 0 ? "chip-green" : "chip-amber"}`}>{left} pontos restantes</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Atributos mudam probabilidades e custos — não fazem de ninguém um super-herói. Cada teste fica entre 5% e 95%.
        </p>
        <div className="grid-2">
          {opt.attributes.map((a) => (
            <div key={a} className="row-between" style={{ flexWrap: "nowrap", borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {ATTR_LABEL[a]?.label ?? a} {bonus === a && <span className="chip chip-amber tiny">+1 profissão</span>}
                </div>
                <div className="tiny muted">{ATTR_LABEL[a]?.hint}</div>
              </div>
              <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => set(a, attrs[a] - 1)} disabled={attrs[a] <= opt.min} aria-label={`Diminuir ${ATTR_LABEL[a]?.label}`}>−</button>
                <span className="mono" style={{ width: 22, textAlign: "center", fontSize: 18 }}>{attrs[a]}</span>
                <button type="button" className="btn btn-sm" onClick={() => set(a, attrs[a] + 1)} disabled={attrs[a] >= opt.max || left <= 0} aria-label={`Aumentar ${ATTR_LABEL[a]?.label}`}>+</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={busy || left !== 0 || f.name.trim().length < 2}>
          {busy ? <Spinner /> : left !== 0 ? `Distribua ${left} ponto(s)` : "Confirmar ficha"}
        </button>
      </div>
    </form>
  );
}

export default function CharacterPage() {
  return (
    <AppShell>
      <CharacterForm />
    </AppShell>
  );
}
