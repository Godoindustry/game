"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import { AppShell, ENDING_LABEL, Spinner } from "@/client/ui";
import { toastError, useSession, useToasts } from "@/client/session";
import { AVATAR_ICON, FriendStatus, useFriends } from "@/client/friends";

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
  difficulty: { key: string; label: string };
}

interface DifficultyOption { key: string; label: string; description: string }

function campaignHref(c: CampaignItem): string {
  if (c.status === "lobby") return c.characterName ? `/campanha/${c.id}/lobby` : `/campanha/${c.id}/personagem`;
  return `/campanha/${c.id}/jogar`;
}

function OnlineFriends() {
  const { data } = useFriends();
  if (!data) return null;
  const online = data.friends.filter((f) => f.online);
  return (
    <section className="stack">
      <div className="row-between">
        <h2 className="h2">Amigos online <span className="chip chip-green mono">{online.length}</span></h2>
        <Link href="/amigos" className="small">
          {data.incoming.length > 0 ? `${data.incoming.length} pedido(s) de amizade →` : "Gerenciar amigos →"}
        </Link>
      </div>
      {online.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          {data.friends.length === 0 ? "Adicione amigos pelo código para ver quando estão online." : "Nenhum amigo online agora."}
        </p>
      ) : (
        <div className="grid-3">
          {online.map((f) => (
            <div key={f.userId} className="panel panel-tight row" style={{ gap: 10, flexWrap: "nowrap" }}>
              <span className="item-icon" style={{ fontSize: 18 }}>{AVATAR_ICON[f.avatar] ?? "•"}</span>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong>{f.displayName}</strong>
                <FriendStatus f={f} />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Dashboard() {
  const router = useRouter();
  const user = useSession((s) => s.user)!;
  const [list, setList] = useState<CampaignItem[] | null>(null);
  const [name, setName] = useState("Noite no Vale");
  const [mode, setMode] = useState<"solo" | "coop">("solo");
  const [difficulty, setDifficulty] = useState("medio");
  const [difficulties, setDifficulties] = useState<DifficultyOption[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const push = useToasts((s) => s.push);

  const load = useCallback(() => api<CampaignItem[]>("GET", "/api/campaigns").then(setList).catch(toastError), []);
  useEffect(() => {
    void load();
    api<DifficultyOption[]>("GET", "/api/meta/difficulties").then(setDifficulties).catch(toastError);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: string }>("POST", "/api/campaigns", { name, mode, difficulty });
      router.push(`/campanha/${r.id}/personagem`);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  }

  /** Admin apaga de vez; convidado sai (a campanha continua para os outros). Sempre com confirmação. */
  async function remove(c: CampaignItem) {
    const owner = c.role === "owner";
    const others = c.members - 1;
    const message = !owner
      ? `Sair de “${c.name}”?\n\nSeu personagem${c.characterName ? ` (${c.characterName})` : ""} será removido. A campanha continua para os outros.`
      : `Apagar “${c.name}” de vez?\n\n${c.characterName ? `O personagem ${c.characterName}, o diário e todo o progresso serão perdidos.` : "Todo o progresso será perdido."}` +
        (others > 0 ? `\n\nAtenção: ela também some para ${others === 1 ? "o outro participante" : `os outros ${others} participantes`}.` : "") +
        "\n\nNão dá para desfazer.";
    if (!window.confirm(message)) return;
    setRemoving(c.id);
    try {
      if (owner) await api("DELETE", `/api/campaigns/${c.id}`);
      else await api("POST", `/api/campaigns/${c.id}/leave`);
      push("ok", owner ? `“${c.name}” foi apagada.` : `Você saiu de “${c.name}”.`);
      await load();
    } catch (err) {
      toastError(err);
    } finally {
      setRemoving(null);
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
          <div className="field">
            <span className="label">Dificuldade</span>
            <div className="row" style={{ gap: 6 }}>
              {difficulties.map((d) => (
                <button type="button" key={d.key} aria-pressed={difficulty === d.key} onClick={() => setDifficulty(d.key)}
                  className={`btn btn-sm ${difficulty === d.key ? (d.key === "insano" ? "btn-danger" : "btn-primary") : ""}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <span className="small muted">{difficulties.find((d) => d.key === difficulty)?.description}</span>
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

      <OnlineFriends />

      <section className="stack">
        <h2 className="h2">Em andamento</h2>
        {!list ? (
          <Spinner />
        ) : active.length === 0 ? (
          <p className="muted">Nenhuma campanha em andamento. Crie uma acima.</p>
        ) : (
          <div className="grid-3">
            {active.map((c) => (
              <div key={c.id} style={{ position: "relative" }}>
                <Link href={campaignHref(c)} className="panel stack" style={{ textDecoration: "none", color: "inherit", gap: 6, height: "100%" }}>
                  <div className="row-between">
                    <strong>{c.name}</strong>
                    <span className={`chip ${c.status === "active" ? "chip-green" : "chip-amber"}`}>{c.status === "active" ? "Em jogo" : "Lobby"}</span>
                  </div>
                  <span className="small muted">
                    {c.mode === "solo" ? "Solo" : `Cooperativo · ${c.members}/${c.maxPlayers}`} · {c.difficulty.label} {c.role === "owner" && "· você é o admin"}
                  </span>
                  <span className="small">{c.characterName ? `Personagem: ${c.characterName}${c.alive === false ? " (morto)" : ""}` : "Personagem ainda não criado"}</span>
                </Link>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={removing === c.id}
                  onClick={() => void remove(c)}
                  title={c.role === "owner" ? "Apagar campanha" : "Sair da campanha"}
                  aria-label={c.role === "owner" ? `Apagar a campanha ${c.name}` : `Sair da campanha ${c.name}`}
                  style={{ position: "absolute", top: -10, right: -10, width: 28, height: 28, minWidth: 0, padding: 0, borderRadius: 999, background: "var(--bg, #0b0d0c)", lineHeight: 1 }}
                >
                  {removing === c.id ? "…" : c.role === "owner" ? "✕" : "↩"}
                </button>
              </div>
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
