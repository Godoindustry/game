"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import { AppShell, ENDING_LABEL, Spinner } from "@/client/ui";
import { toastError, useSession } from "@/client/session";

interface CampaignItem {
  id: string;
  name: string;
  mode: "solo" | "coop";
  status: "lobby" | "active" | "finished";
  role: string;
  members: number;
  maxPlayers: number;
  characterName: string | null;
  alive: boolean | null;
  ending: string | null;
  endingType: string | null;
  updatedAt: string;
}

function campaignHref(c: CampaignItem): string {
  if (c.status === "lobby") return c.characterName ? `/campanha/${c.id}/lobby` : `/campanha/${c.id}/personagem`;
  return `/campanha/${c.id}/jogar`;
}

function Dashboard() {
  const router = useRouter();
  const user = useSession((s) => s.user)!;
  const [list, setList] = useState<CampaignItem[] | null>(null);
  const [name, setName] = useState("Noite no Vale");
  const [mode, setMode] = useState<"solo" | "coop">("solo");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<CampaignItem[]>("GET", "/api/campaigns").then(setList).catch(toastError), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: string }>("POST", "/api/campaigns", { name, mode });
      router.push(`/campanha/${r.id}/personagem`);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim().split("/").pop() ?? "";
    if (clean) router.push(`/convite/${encodeURIComponent(clean)}`);
  }

  const active = list?.filter((c) => c.status !== "finished") ?? [];
  const finished = list?.filter((c) => c.status === "finished") ?? [];

  return (
    <div className="stack-lg">
      <div className="row-between">
        <div>
          <p className="label amber" style={{ marginBottom: 4 }}>Canal aberto</p>
          <h1 className="h1" style={{ fontSize: "clamp(28px,4vw,40px)" }}>Olá, {user.displayName}</h1>
        </div>
        {user.premium && <span className="chip chip-amber">★ Conta Premium</span>}
      </div>

      <div className="grid-2">
        <form className="panel corner stack" onSubmit={create}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <span className="h2">Nova campanha</span>
            <span className="chip">Vale Silente</span>
          </div>
          <label className="field">
            <span className="label">Nome</span>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span className="label">Modo</span>
            <div className="row">
              {(["solo", "coop"] as const).map((m) => (
                <button type="button" key={m} className={`btn btn-sm ${mode === m ? "btn-primary" : ""}`} onClick={() => setMode(m)} aria-pressed={mode === m}>
                  {m === "solo" ? "Solo" : "Cooperativo (até 4)"}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy || name.trim().length < 3}>
            {busy ? <Spinner /> : "Criar e montar personagem"}
          </button>
        </form>

        <form className="panel stack" onSubmit={join}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <span className="h2">Entrar com convite</span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Cole o código ou o link que o administrador da campanha enviou.</p>
          <input className="input mono" placeholder="código ou link do convite" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" disabled={!code.trim()}>
            Entrar na campanha
          </button>
        </form>
      </div>

      <section className="stack">
        <h2 className="h2">Em andamento</h2>
        {!list ? (
          <Spinner />
        ) : active.length === 0 ? (
          <p className="muted">Nenhuma campanha em andamento. Crie uma acima.</p>
        ) : (
          <div className="grid-3">
            {active.map((c) => (
              <Link key={c.id} href={campaignHref(c)} className="panel stack" style={{ textDecoration: "none", color: "inherit", gap: 6 }}>
                <div className="row-between">
                  <strong>{c.name}</strong>
                  <span className={`chip ${c.status === "active" ? "chip-green" : "chip-amber"}`}>{c.status === "active" ? "Em jogo" : "Lobby"}</span>
                </div>
                <span className="small muted">
                  {c.mode === "solo" ? "Solo" : `Cooperativo · ${c.members}/${c.maxPlayers}`} {c.role === "owner" && "· você é o admin"}
                </span>
                <span className="small">{c.characterName ? `Personagem: ${c.characterName}${c.alive === false ? " (morto)" : ""}` : "Personagem ainda não criado"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {finished.length > 0 && (
        <section className="stack">
          <h2 className="h2">Encerradas</h2>
          <div className="table-wrap panel panel-tight">
            <table className="table">
              <thead>
                <tr><th>Campanha</th><th>Personagem</th><th>Final</th><th /></tr>
              </thead>
              <tbody>
                {finished.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.characterName ?? "—"}</td>
                    <td>
                      <span className={`chip ${c.endingType === "victory" ? "chip-green" : c.endingType === "defeat" ? "chip-red" : ""}`}>
                        {ENDING_LABEL[c.ending ?? ""] ?? c.ending}
                      </span>
                    </td>
                    <td><Link href={`/campanha/${c.id}/jogar`}>Ver diário</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
