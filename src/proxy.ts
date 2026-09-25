/**
 * Redireciona para /entrar quem acessa área logada sem cookie de sessão.
 * É só conveniência de navegação: a autorização real acontece em cada rota da API.
 */
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.get("ls_session")) {
    const url = new URL("/entrar", request.url);
    url.searchParams.set("voltar", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/painel/:path*", "/perfil/:path*", "/ranking/:path*", "/campanha/:path*", "/admin/:path*", "/convite/:path*"],
};
