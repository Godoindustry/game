"use client";
import { useState } from "react";
import { api } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";
import { toastError, useToasts } from "@/client/session";
import { AVATAR_ICON, FriendStatus, useFriends, type FriendRequest } from "@/client/friends";

function FriendsView() {
  const push = useToasts((s) => s.push);
  const { data, error, reload } = useFriends();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await reload();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    void run("add", async () => {
      const r = await api<{ status: "pending" | "accepted"; displayName: string }>("POST", "/api/friends/requests", { code });
      push("ok", r.status === "accepted" ? `Você e ${r.displayName} agora são amigos.` : `Pedido enviado para ${r.displayName}.`);
      setCode("");
    });
  }

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.code);
      push("ok", "Código copiado.");
    } catch {
      push("info", `Seu código: ${data.code}`);
    }
  }

  if (!data) return error ? <div className="error-box">{error}</div> : <Spinner />;

  const requestRow = (r: FriendRequest, incoming: boolean) => (
    <div key={r.id} className="panel panel-tight row-between">
      <span className="row" style={{ gap: 10 }}>
        <span className="item-icon" style={{ fontSize: 18 }}>{AVATAR_ICON[r.avatar] ?? "•"}</span>
        <strong>{r.displayName}</strong>
      </span>
      <span className="row" style={{ gap: 6 }}>
        {incoming && (
          <button className="btn btn-sm btn-primary" disabled={busy !== null}
            onClick={() => run(r.id, () => api("POST", `/api/friends/requests/${r.id}`, { accept: true }))}>
            Aceitar
          </button>
        )}
        <button className="btn btn-sm btn-ghost" disabled={busy !== null}
          onClick={() => run(r.id, () => incoming
            ? api("POST", `/api/friends/requests/${r.id}`, { accept: false })
            : api("DELETE", `/api/friends/${r.userId}`))}>
          {incoming ? "Recusar" : "Cancelar"}
        </button>
      </span>
    </div>
  );

  return (
    <div className="stack-lg">
      <div className="row-between">
        <h1 className="h1" style={{ fontSize: 40 }}>Amigos</h1>
        <span className="chip chip-green mono">{data.onlineCount} online</span>
      </div>

      <div className="grid-2">
        <div className="panel corner stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Seu código</span></div>
          <p className="small muted" style={{ margin: 0 }}>Passe este código para um amigo te adicionar.</p>
          <div className="row" style={{ gap: 8 }}>
            <span className="mono amber" style={{ fontSize: 28, letterSpacing: "0.12em" }}>{data.code}</span>
            <button className="btn btn-sm" onClick={copyCode}>Copiar</button>
          </div>
        </div>
        <form className="panel stack" onSubmit={add}>
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Adicionar amigo</span></div>
          <input className="input mono" placeholder="ex.: K7QM-4TZP" maxLength={20} value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Código do amigo" />
          <button className="btn btn-primary" disabled={busy !== null || code.replace(/[^A-Za-z0-9]/g, "").length !== 8}>
            {busy === "add" ? <Spinner /> : "Enviar pedido"}
          </button>
        </form>
      </div>

      {data.incoming.length > 0 && (
        <section className="stack">
          <h2 className="h2">Pedidos recebidos <span className="chip chip-amber">{data.incoming.length}</span></h2>
          {data.incoming.map((r) => requestRow(r, true))}
        </section>
      )}

      <section className="stack">
        <h2 className="h2">Seus amigos</h2>
        {data.friends.length === 0 ? (
          <p className="muted">Nenhum amigo ainda. Troque códigos com quem vai sobreviver com você.</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {data.friends.map((f) => (
              <div key={f.userId} className="panel panel-tight row-between" style={{ opacity: f.online ? 1 : 0.7 }}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="item-icon" style={{ fontSize: 18 }}>{AVATAR_ICON[f.avatar] ?? "•"}</span>
                  <span className="stack" style={{ gap: 2 }}>
                    <strong>{f.displayName}</strong>
                    <FriendStatus f={f} />
                  </span>
                </span>
                <button className="btn btn-sm btn-ghost" disabled={busy !== null}
                  onClick={() => confirm(`Remover ${f.displayName} dos amigos?`) && run(f.userId, () => api("DELETE", `/api/friends/${f.userId}`))}>
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {data.outgoing.length > 0 && (
        <section className="stack">
          <h2 className="h2">Pedidos enviados</h2>
          {data.outgoing.map((r) => requestRow(r, false))}
        </section>
      )}
    </div>
  );
}

export default function FriendsPage() {
  return (
    <AppShell>
      <FriendsView />
    </AppShell>
  );
}
