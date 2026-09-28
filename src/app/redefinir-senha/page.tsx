"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthFrame } from "@/client/AuthFrame";
import { api } from "@/client/api";
import { Spinner } from "@/client/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const passwordValid = password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("As senhas não conferem.");
    if (!passwordValid) return setError("A senha precisa ter pelo menos 8 caracteres, com letras e números.");
    setBusy(true);
    setError("");
    try {
      await api("POST", "/api/auth/reset", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <div className="error-box">Link inválido.</div>;
  if (done)
    return (
      <div className="stack">
        <div className="ok-box">Senha redefinida. Sessões antigas foram encerradas.</div>
        <Link href="/entrar" className="btn btn-primary btn-block">
          Entrar
        </Link>
      </div>
    );
  return (
    <form className="stack" onSubmit={submit}>
      {error && <div className="error-box">{error}</div>}
      <label className="field">
        <span className="label">Nova senha</span>
        <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="hint">Mínimo 8 caracteres, com letras e números.</span>
      </label>
      <label className="field">
        <span className="label">Confirmar senha</span>
        <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-block" disabled={busy || !passwordValid}>
        {busy ? <Spinner /> : "Redefinir"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <AuthFrame title="Nova senha">
      <Suspense fallback={<Spinner />}>
        <ResetForm />
      </Suspense>
    </AuthFrame>
  );
}
