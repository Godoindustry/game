"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthFrame } from "@/client/AuthFrame";
import { api } from "@/client/api";
import { Spinner } from "@/client/ui";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>("POST", "/api/auth/forgot", { email });
      setDone(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Recuperar senha" subtitle="Enviaremos um link válido por 30 minutos.">
      {done ? (
        <div className="ok-box">{done}</div>
      ) : (
        <form className="stack" onSubmit={submit}>
          {error && <div className="error-box">{error}</div>}
          <label className="field">
            <span className="label">E-mail da conta</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button className="btn btn-primary btn-block" disabled={busy || !email}>
            {busy ? <Spinner /> : "Enviar link"}
          </button>
        </form>
      )}
      <Link href="/entrar" className="small">
        ← Voltar ao login
      </Link>
    </AuthFrame>
  );
}
