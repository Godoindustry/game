/** Caminho de volta depois do login/cadastro (ex.: link de convite). Só caminhos internos (evita open redirect). */
export function safeReturn(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/painel";
}

/** Sufixo `?voltar=…` para levar o destino adiante entre entrar, cadastro e Google. */
export function returnQuery(path: string | null | undefined): string {
  const target = safeReturn(path);
  return target === "/painel" ? "" : `?voltar=${encodeURIComponent(target)}`;
}
