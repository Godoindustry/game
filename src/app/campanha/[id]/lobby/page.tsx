"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";
import { toastError, useToasts } from "@/client/session";

interface Lobby {
  id: string;
  name: string;
  mode: "solo" | "coop";
  status: string;
  maxPlayers: number;
  isOwner: boolean;
  members: { userId: string; displayName: string; role: string; hasCharacter: boolean; characterName: string | null; isMe: boolean }[];
}

function LobbyView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const push = useToasts((s) => s.push);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [invite, setInvite] = useState<{ code: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const l = await api<Lobby>("GET", `/api/campaigns/${id}/lobby`);
      if (l.status !== "lobby") return router.replace(`/campanha/${id}/jogar`);
      setLobby(l);
    } catch (err) {
      toastError(err);
    }
  }, [id, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca assíncrona ao montar; o setState ocorre após o await
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!lobby) return <Spinner />;
  const me = lobby.members.find((m) => m.isMe);
  const ready = lobby.members.every((m) => m.hasCharacter);

  return (
    <div className="stack-lg">
      <div>
        <p className="label amber" style={{ marginBottom: 4 }}>Lobby · {lobby.mode === "solo" ? "Solo" : "Cooperativo"}</p>
        <h1 className="h1" style={{ fontSize: 40 }}>{lobby.name}</h1>
      </div>
      <div className="grid-2">
        <section className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <span className="h2">Sobreviventes</span>
            <span className="chip mono">{lobby.members.length}/{lobby.maxPlayers}</span>
          </div>
          {lobby.members.map((m) => (
            <div key={m.userId} className="row-between" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
              <div>
                <strong>{m.displayName}</strong> {m.role === "owner" && <span className="chip chip-amber tiny">admin</span>} {m.isMe && <span className="tiny faint">(você)</span>}
                <div className="small muted">{m.hasCharacter ? `Personagem: ${m.characterName}` : "Montando a ficha…"}</div>
              </div>
              <div className="row">
                <span className={`chip ${m.hasCharacter ? "chip-green" : ""}`}>{m.hasCharacter ? "Pronto" : "Aguardando"}</span>
                {lobby.isOwner && !m.isMe && (
                  <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(() => api("DELETE", `/api/campaigns/${id}/members/${m.userId}`))}>
                    Remover
                  </button>
                )}
              </div>
            </div>
          ))}
          {me && !me.hasCharacter && <Link className="btn btn-primary" href={`/campanha/${id}/personagem`}>Criar meu personagem</Link>}
        </section>
        <section className="panel stack">
          {lobby.mode === "coop" && lobby.isOwner && (
            <>
              <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Convite</span></div>
              <p className="small muted" style={{ margin: 0 }}>Links valem 48 horas. O código só é mostrado agora — gere outro se precisar.</p>
              {invite ? (
                <div className="stack">
                  <input className="input mono small" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
                  <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(invite.url).then(() => push("ok", "Link copiado."))}>Copiar link</button>
                </div>
              ) : (
                <button className="btn" disabled={busy || lobby.members.length >= lobby.maxPlayers} onClick={() => run(async () => setInvite(await api("POST", `/api/campaigns/${id}/invites`)))}>
                  Gerar link de convite
                </button>
              )}
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(async () => { await api("DELETE", `/api/campaigns/${id}/invites`); setInvite(null); push("ok", "Convites revogados."); })}>
                Revogar convites
              </button>
            </>
          )}
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Início</span></div>
          <p className="small muted" style={{ margin: 0 }}>
            A campanha começa às 23h40, logo após a queda. Tempo de jogo só passa quando vocês agem — offline, o vale espera.
          </p>
          {lobby.isOwner ? (
            <button className="btn btn-primary" disabled={busy || !ready} onClick={() => run(async () => { await api("POST", `/api/campaigns/${id}/start`); router.push(`/campanha/${id}/jogar`); })}>
              {ready ? "Iniciar campanha" : "Aguardando fichas"}
            </button>
          ) : (
            <div className="row small muted"><Spinner /> Aguardando o administrador iniciar…</div>
          )}
          {lobby.isOwner ? (
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => confirm("Encerrar a campanha?") && run(async () => { await api("POST", `/api/campaigns/${id}/end`); router.push("/painel"); })}>
              Encerrar campanha
            </button>
          ) : (
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(async () => { await api("POST", `/api/campaigns/${id}/leave`); router.push("/painel"); })}>
              Sair da campanha
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <AppShell>
      <LobbyView />
    </AppShell>
  );
}
