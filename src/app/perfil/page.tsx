"use client";
import { useEffect, useState } from "react";
import { api } from "@/client/api";
import { AppShell, Spinner } from "@/client/ui";
import { toastError, useSession, useToasts } from "@/client/session";
import { Avatar } from "@/client/Avatar";
import { CLASSIC_AVATARS, CREATURE_AVATARS, avatarName } from "@/shared/avatars";

interface Profile {
  displayName: string;
  avatar: string;
  bio: string;
  email: string;
  memberSince: string;
  premium: { source: string; slot: number | null } | null;
  earlySlots: { used: number; total: number };
  stats: { games: number; wins: number; bestScore: number };
}
interface Achievement { id: string; name: string; description: string; icon: string; points: number; unlockedAt: string | null }

const ICONS: Record<string, string> = {
  bussola: "🧭", radio: "📻", lanterna: "🔦", mochila: "🎒", fogueira: "🔥", mapa: "🗺️", corda: "🪢", cruz: "✚",
  estrela: "★", lua: "☾", helicoptero: "🚁", lupa: "🔎", chama: "🔥", tenda: "⛺", balao: "💬", grupo: "👥", caveira: "☠",
};

/** Grade rolável: criaturas do vale primeiro, depois os ícones clássicos. */
function AvatarPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const option = (id: string) => (
    <button
      type="button"
      key={id}
      onClick={() => onChange(id)}
      aria-pressed={value === id}
      aria-label={avatarName(id)}
      title={avatarName(id)}
      style={{
        display: "grid", placeItems: "center", width: 48, height: 48, padding: 0, cursor: "pointer",
        borderRadius: 10, background: "transparent",
        border: value === id ? "2px solid var(--amber-2, #d8c298)" : "2px solid transparent",
      }}
    >
      <Avatar id={id} size={40} />
    </button>
  );
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))", gap: 4 } as const;
  return (
    <div style={{ maxHeight: "min(360px, 50vh)", overflowY: "auto", padding: 4, borderRadius: 10, background: "rgba(0,0,0,.2)" }}>
      <div className="label" style={{ margin: "4px 2px 6px" }}>Criaturas</div>
      <div style={grid}>{CREATURE_AVATARS.map((a) => option(a.id))}</div>
      <div className="label" style={{ margin: "12px 2px 6px" }}>Clássicos</div>
      <div style={grid}>{CLASSIC_AVATARS.map((id) => option(id))}</div>
    </div>
  );
}

function ProfileView() {
  const fetchMe = useSession((s) => s.fetchMe);
  const push = useToasts((s) => s.push);
  const [p, setP] = useState<Profile | null>(null);
  const [ach, setAch] = useState<Achievement[]>([]);
  const [form, setForm] = useState({ displayName: "", avatar: "bussola", bio: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Profile>("GET", "/api/profile").then((r) => {
      setP(r);
      setForm({ displayName: r.displayName, avatar: r.avatar, bio: r.bio });
    }).catch(toastError);
    api<Achievement[]>("GET", "/api/achievements").then(setAch).catch(toastError);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setP(await api<Profile>("PATCH", "/api/profile", form));
      await fetchMe();
      push("ok", "Perfil salvo.");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!p) return <Spinner />;
  const points = ach.filter((a) => a.unlockedAt).reduce((s, a) => s + a.points, 0);
  return (
    <div className="stack-lg">
      <div className="row-between">
        <h1 className="h1" style={{ fontSize: 40 }}>Perfil</h1>
        {p.premium ? (
          <span className="chip chip-amber">★ Premium {p.premium.slot ? `· pioneiro nº ${p.premium.slot}` : "· concedido"}</span>
        ) : (
          <span className="chip">Conta gratuita · vagas pioneiro: {p.earlySlots.used}/{p.earlySlots.total}</span>
        )}
      </div>
      <div className="grid-2">
        <form className="panel stack" onSubmit={save}>
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Identificação</span></div>
          <label className="field">
            <span className="label">Nome de exibição</span>
            <input className="input" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <div className="field">
            <span className="label">Ícone</span>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <Avatar id={form.avatar} size={64} />
              <span className="muted">{avatarName(form.avatar)}</span>
            </div>
            <AvatarPicker value={form.avatar} onChange={(avatar) => setForm({ ...form, avatar })} />
          </div>
          <label className="field">
            <span className="label">Sobre você</span>
            <textarea className="textarea" maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : "Salvar"}</button>
          <p className="tiny faint" style={{ margin: 0 }}>{p.email} · desde {new Date(p.memberSince).toLocaleDateString("pt-BR")}</p>
        </form>
        <div className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}><span className="h2">Histórico</span></div>
          <div className="grid-3">
            <div><div className="label">Campanhas</div><div className="mono" style={{ fontSize: 28 }}>{p.stats.games}</div></div>
            <div><div className="label">Resgates</div><div className="mono green" style={{ fontSize: 28 }}>{p.stats.wins}</div></div>
            <div><div className="label">Melhor pontuação</div><div className="mono amber" style={{ fontSize: 28 }}>{p.stats.bestScore}</div></div>
          </div>
        </div>
      </div>
      <section className="stack">
        <div className="row-between">
          <h2 className="h2">Conquistas</h2>
          <span className="chip chip-amber mono">{points} pts</span>
        </div>
        <div className="grid-3">
          {ach.map((a) => (
            <div key={a.id} className="panel panel-tight row" style={{ opacity: a.unlockedAt ? 1 : 0.45, alignItems: "flex-start", flexWrap: "nowrap" }}>
              <div className="item-icon" style={{ fontSize: 18 }}>{ICONS[a.icon] ?? "•"}</div>
              <div>
                <strong>{a.name}</strong> <span className="tiny faint mono">{a.points}pts</span>
                <div className="small muted">{a.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AppShell>
      <ProfileView />
    </AppShell>
  );
}
