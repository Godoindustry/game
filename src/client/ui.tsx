"use client";
/** Componentes reutilizáveis de interface — S-OS v1.4 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession, useToasts } from "./session";

// ── Logo / Logotipo ────────────────────────────────────────────────────────
// ECG transformando-se em linha de montanha — o símbolo da sobrevivência.
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {/* Fundo com borda âmbar */}
      <rect x="1" y="1" width="30" height="30" rx="5" fill="#0d1210" stroke="#e8a020" strokeWidth="1.2" />
      {/* Linha de ECG: flat → pico → volta → montanha */}
      <path
        d="M3 18 H8 L10 13 L13 24 L16 8 L19 21 L21 16 H24 L26 14 L28 18 H31"
        fill="none" stroke="#e8a020" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Ponto de atividade (pequeno círculo na crista) */}
      <circle cx="16" cy="8" r="1.2" fill="#ffbe50" opacity="0.8" />
    </svg>
  );
}

// Emblema compacto para contextos pequenos
export function Emblem({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {/* Triângulo invertido com sinal de rádio */}
      <polygon points="10,2 19,17 1,17" fill="none" stroke="#e8a020" strokeWidth="1.5" strokeLinejoin="round" />
      <text x="10" y="14.5" textAnchor="middle" fontFamily="monospace" fontSize="7" fontWeight="bold" fill="#ffbe50">!</text>
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Linha de Sobrevivência — início">
      <Logo />
      <span className="brand-name">
        Linha de <span>Sobrevivência</span>
      </span>
    </Link>
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────────
export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
          title="Clique para dispensar"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ── Medidor de status vital ───────────────────────────────────────────────
export function Meter({
  label, value, max = 100, color, display, invert,
}: {
  label: string; value: number; max?: number; color?: string; display?: string; invert?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  // invert: valores altos são ruins (fome, sede, dor…)
  const bad = invert ? pct : 100 - pct;
  const auto = bad >= 80 ? "var(--red)" : bad >= 55 ? "var(--amber)" : "var(--green)";
  const isCritical = bad >= 80;
  return (
    <div
      className="meter"
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div
          className="meter-fill"
          style={{
            width: `${pct}%`,
            background: color ?? auto,
            boxShadow: isCritical ? `0 0 6px ${color ?? auto}` : undefined,
          }}
        />
      </div>
      <span
        className="meter-value"
        style={{ color: isCritical ? (color ?? auto) : undefined }}
      >
        {display ?? Math.round(value)}
      </span>
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

// ── Modal ──────────────────────────────────────────────────────────────────
export function Modal({
  children, onClose, label,
}: {
  children: ReactNode; onClose?: () => void; label: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

// ── Drawer (painel lateral) ────────────────────────────────────────────────
export function Drawer({
  children, onClose, title,
}: {
  children: ReactNode; onClose: () => void; title: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="h2">{title}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// ── Guardar sessão ─────────────────────────────────────────────────────────
export function useRequireUser(opts: { master?: boolean } = {}) {
  const { user, loaded, fetchMe } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loaded) void fetchMe();
  }, [loaded, fetchMe]);
  useEffect(() => {
    if (!loaded) return;
    if (!user) router.replace(`/entrar?voltar=${encodeURIComponent(pathname)}`);
    else if (opts.master && user.role !== "master") router.replace("/painel");
  }, [loaded, user, router, pathname, opts.master]);
  return user;
}

// ── Navegação ──────────────────────────────────────────────────────────────
const NAV = [
  { href: "/painel",  label: "Campanhas" },
  { href: "/ranking", label: "Ranking"   },
  { href: "/perfil",  label: "Perfil"    },
];

export function AppShell({ children, master }: { children: ReactNode; master?: boolean }) {
  const user = useRequireUser({ master });
  const pathname = usePathname();
  const router = useRouter();
  const logout = useSession((s) => s.logout);
  if (!user) {
    return (
      <div className="container page row" style={{ justifyContent: "center", minHeight: "60vh" }}>
        <Spinner /> <span className="muted">Verificando sessão…</span>
      </div>
    );
  }
  return (
    <>
      <header className="topnav">
        <div className="container topnav-inner">
          <Brand />
          <div className="spacer" />
          <nav className="navlinks" aria-label="Navegação principal">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={pathname.startsWith(n.href) ? "active" : ""}
              >
                {n.label}
              </Link>
            ))}
            {user.role === "master" && (
              <Link href="/admin" className={pathname.startsWith("/admin") ? "active" : ""}>
                Admin
              </Link>
            )}
          </nav>
          <div className="row hide-mobile" style={{ gap: 8 }}>
            {user.premium && <span className="chip chip-amber">★ Premium</span>}
            <span className="small muted" style={{ opacity: 0.75 }}>{user.displayName}</span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await logout();
              router.replace("/entrar");
            }}
          >
            Sair
          </button>
        </div>
      </header>
      <main className="container page">{children}</main>
    </>
  );
}

// ── Utilitários ────────────────────────────────────────────────────────────
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export const ENDING_LABEL: Record<string, string> = {
  resgate_radio:       "Resgate pelo rádio",
  resgate_sinalizador: "Resgate pelo sinalizador",
  resgate_fogueira:    "Resgate pela fumaça",
  morte:               "Morte",
  abandonada:          "Encerrada",
};

// ── ECG inline SVG (para avatar) ──────────────────────────────────────────
export function EcgLine({
  alive = true,
  injured = false,
}: {
  alive?: boolean; injured?: boolean;
}) {
  if (!alive) {
    // linha plana — morte
    return (
      <svg className="avatar-ecg" viewBox="0 0 36 8" aria-hidden="true">
        <line x1="0" y1="4" x2="36" y2="4" stroke="var(--red)" strokeWidth="0.8" strokeOpacity="0.5" />
      </svg>
    );
  }
  if (injured) {
    // ritmo irregular
    return (
      <svg className="avatar-ecg" viewBox="0 0 36 8" aria-hidden="true">
        <polyline
          points="0,4 4,4 5,2 6,7 7,1 9,4 13,4 14,3 15,5 16,4 20,4 22,4 23,2 24,6 25,1 27,4 32,4 34,4"
          fill="none" stroke="var(--red-2)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }
  // ritmo normal
  return (
    <svg className="avatar-ecg" viewBox="0 0 36 8" aria-hidden="true">
      <polyline
        points="0,4 8,4 10,2 11,6 12,1 14,4 20,4 22,2 23,6 24,1 26,4 36,4"
        fill="none" stroke="var(--green)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
