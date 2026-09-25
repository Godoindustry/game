/** Tabela de rotas da API. Cada rota é fina: valida entrada via serviço e responde JSON. */
import { Router, sessionCookie, clearSessionCookie, csrfCookie, serializeCookie, type Ctx } from "./core";
import * as auth from "../services/auth";
import * as campaigns from "../services/campaigns";
import * as game from "../services/game";
import * as profile from "../services/profile";
import * as admin from "../services/admin";
import { listAchievements, ranking } from "../services/achievements";
import { earlySlotsUsed } from "../services/premium";
import { getConfig } from "../config";
import { initDb } from "../db/database";
import { bootDatabase } from "../db/seed";
import { PROFESSIONS } from "../engine/character";
import { ATTRIBUTE_KEYS, BODY_TYPES, CONDITIONINGS, EXPERIENCES } from "../engine/types";
import { ATTR_MAX_CREATION, ATTR_MIN, ATTR_POINTS_TO_DISTRIBUTE, MAX_EXPERIENCES } from "../engine/constants";
import { AVATARS } from "../services/profile";

const u = (ctx: Ctx) => ctx.user!;
const ua = (ctx: Ctx) => ctx.req.headers.get("user-agent");

function buildRouter(): Router {
  const r = new Router();

  // ---------- Meta ----------
  r.get("/api/meta", async () => ({
    app: "Linha de Sobrevivência",
    googleEnabled: auth.googleEnabled(),
    earlySlots: { used: await earlySlotsUsed(), total: getConfig().PREMIUM_EARLY_SLOTS },
  }));
  r.get("/api/meta/character-options", () => ({
    attributes: ATTRIBUTE_KEYS,
    professions: Object.entries(PROFESSIONS).map(([id, p]) => ({ id, label: p.label, bonus: p.bonus })),
    bodyTypes: BODY_TYPES,
    conditionings: CONDITIONINGS,
    experiences: EXPERIENCES,
    points: ATTR_POINTS_TO_DISTRIBUTE,
    min: ATTR_MIN,
    max: ATTR_MAX_CREATION,
    maxExperiences: MAX_EXPERIENCES,
    avatars: AVATARS,
  }));

  // ---------- Autenticação ----------
  r.get("/api/auth/csrf", (ctx) => {
    const existing = ctx.cookies.ls_csrf;
    if (existing && existing.length >= 20) return { csrfToken: existing };
    const { cookie, token } = csrfCookie();
    ctx.setCookies.push(cookie);
    return { csrfToken: token };
  });
  r.post("/api/auth/register", async (ctx) => {
    const user = await auth.register(await ctx.body(), ctx.ip);
    ctx.setCookies.push(sessionCookie(await auth.createSession(user.id, ctx.ip, ua(ctx))));
    return { user };
  }, { rate: "auth" });
  r.post("/api/auth/login", async (ctx) => {
    const { token, user } = await auth.login(await ctx.body(), ctx.ip, ua(ctx));
    ctx.setCookies.push(sessionCookie(token));
    return { user };
  }, { rate: "auth" });
  r.post("/api/auth/logout", async (ctx) => {
    await auth.logout(ctx.cookies.ls_session);
    ctx.setCookies.push(clearSessionCookie());
    return { ok: true };
  });
  r.get("/api/auth/me", (ctx) => ({ user: ctx.user }));
  r.post("/api/auth/forgot", async (ctx) => {
    await auth.requestPasswordReset(await ctx.body(), ctx.ip);
    return { ok: true, message: "Se o e-mail estiver cadastrado, você receberá um link em instantes." };
  }, { rate: "auth" });
  r.post("/api/auth/reset", async (ctx) => {
    await auth.resetPassword(await ctx.body(), ctx.ip);
    return { ok: true };
  }, { rate: "auth" });
  r.get("/api/auth/google/start", (ctx) => {
    const { url, state, verifier } = auth.googleStart();
    ctx.setCookies.push(serializeCookie("ls_oauth_state", state, { maxAgeSec: 600 }));
    ctx.setCookies.push(serializeCookie("ls_oauth_verifier", verifier, { maxAgeSec: 600 }));
    return new Response(null, { status: 302, headers: { Location: url } });
  }, { raw: true, rate: "auth" });
  r.get("/api/auth/google/callback", async (ctx) => {
    const code = ctx.url.searchParams.get("code") ?? "";
    const state = ctx.url.searchParams.get("state") ?? "";
    ctx.setCookies.push(serializeCookie("ls_oauth_state", "", { maxAgeSec: 0 }), serializeCookie("ls_oauth_verifier", "", { maxAgeSec: 0 }));
    try {
      const { token } = await auth.googleCallback(code, state, ctx.cookies.ls_oauth_state, ctx.cookies.ls_oauth_verifier, ctx.ip, ua(ctx));
      ctx.setCookies.push(sessionCookie(token));
      return new Response(null, { status: 302, headers: { Location: "/painel" } });
    } catch {
      return new Response(null, { status: 302, headers: { Location: "/entrar?erro=google" } });
    }
  }, { raw: true, rate: "auth" });

  // ---------- Perfil, conquistas, ranking ----------
  r.get("/api/profile", (ctx) => profile.getProfile(u(ctx)), { auth: true });
  r.patch("/api/profile", async (ctx) => profile.updateProfile(u(ctx), await ctx.body()), { auth: true });
  r.get("/api/achievements", (ctx) => listAchievements(u(ctx).id), { auth: true });
  r.get("/api/ranking", () => ranking(50), { auth: true });

  // ---------- Campanhas ----------
  r.get("/api/campaigns", (ctx) => campaigns.listMyCampaigns(u(ctx)), { auth: true });
  r.post("/api/campaigns", async (ctx) => {
    const c = await campaigns.createCampaign(u(ctx), await ctx.body());
    return { id: c.id };
  }, { auth: true, rate: "action" });
  r.get("/api/campaigns/:id/lobby", (ctx) => campaigns.lobbyView(u(ctx), ctx.params.id), { auth: true });
  r.post("/api/campaigns/:id/invites", (ctx) => campaigns.createInvite(u(ctx), ctx.params.id), { auth: true, rate: "action" });
  r.delete("/api/campaigns/:id/invites", (ctx) => campaigns.revokeInvites(u(ctx), ctx.params.id), { auth: true });
  r.post("/api/invites/accept", async (ctx) => campaigns.acceptInvite(u(ctx), await ctx.body()), { auth: true, rate: "action" });
  r.post("/api/campaigns/:id/character", async (ctx) => campaigns.createCharacter(u(ctx), ctx.params.id, await ctx.body()), { auth: true, rate: "action" });
  r.post("/api/campaigns/:id/start", (ctx) => campaigns.startCampaign(u(ctx), ctx.params.id), { auth: true });
  r.delete("/api/campaigns/:id/members/:userId", (ctx) => campaigns.removeMember(u(ctx), ctx.params.id, ctx.params.userId, ctx.ip), { auth: true });
  r.post("/api/campaigns/:id/leave", (ctx) => campaigns.leaveCampaign(u(ctx), ctx.params.id), { auth: true });
  r.post("/api/campaigns/:id/end", (ctx) => campaigns.endCampaign(u(ctx), ctx.params.id, ctx.ip), { auth: true });

  // ---------- Jogo ----------
  r.get("/api/campaigns/:id/state", (ctx) => game.getState(u(ctx), ctx.params.id), { auth: true });
  r.post("/api/campaigns/:id/sync", (ctx) => game.sync(u(ctx), ctx.params.id), { auth: true, rate: "api" });
  r.post("/api/campaigns/:id/actions", async (ctx) => {
    const res = await game.submitAction(u(ctx), ctx.params.id, await ctx.body());
    return { ...res, state: await game.getState(u(ctx), ctx.params.id) };
  }, { auth: true, rate: "action" });
  r.delete("/api/campaigns/:id/actions/pending", async (ctx) => {
    await game.cancelAction(u(ctx), ctx.params.id);
    return game.getState(u(ctx), ctx.params.id);
  }, { auth: true });

  // ---------- Administração (ADM MASTER) ----------
  r.get("/api/admin/stats", () => admin.stats(), { master: true });
  r.get("/api/admin/users", (ctx) => admin.listUsers(ctx.url.searchParams.get("q")), { master: true });
  r.post("/api/admin/users/:id/action", async (ctx) => admin.userAction(u(ctx), ctx.params.id, await ctx.body(), ctx.ip), { master: true });
  r.get("/api/admin/campaigns", () => admin.listCampaigns(), { master: true });
  r.post("/api/admin/campaigns/:id/end", (ctx) => admin.adminEndCampaign(u(ctx), ctx.params.id, ctx.ip), { master: true });
  r.get("/api/admin/logs", () => admin.logs(), { master: true });
  r.get("/api/admin/outbox", () => admin.outbox(), { master: true });

  return r;
}

type G = typeof globalThis & { __lsRouter?: Router; __lsBoot?: Promise<void> };

/** Abre o banco, migra, sincroniza conteúdo e garante o ADM MASTER — uma vez por processo. */
export function ensureBooted(): Promise<void> {
  const g = globalThis as G;
  g.__lsBoot ??= initDb()
    .then((db) => bootDatabase(db))
    .catch((err) => {
      g.__lsBoot = undefined; // permite tentar de novo na próxima requisição
      throw err;
    });
  return g.__lsBoot;
}

export async function handleApi(req: Request): Promise<Response> {
  const g = globalThis as G;
  await ensureBooted();
  g.__lsRouter ??= buildRouter();
  return g.__lsRouter.handle(req);
}

/** Testes: força novo boot/roteador após trocar o banco. */
export function resetApiForTests(): void {
  const g = globalThis as G;
  g.__lsBoot = undefined;
  g.__lsRouter = undefined;
}
