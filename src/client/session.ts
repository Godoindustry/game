"use client";
import { create } from "zustand";
import { api, ApiError } from "./api";

export interface User {
  id: string;
  email: string;
  role: "user" | "master";
  displayName: string;
  avatar: string;
  premium: boolean;
}

interface SessionState {
  user: User | null;
  loaded: boolean;
  fetchMe: () => Promise<User | null>;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  loaded: false,
  fetchMe: async () => {
    try {
      const r = await api<{ user: User | null }>("GET", "/api/auth/me");
      set({ user: r.user, loaded: true });
      return r.user;
    } catch {
      set({ user: null, loaded: true });
      return null;
    }
  },
  setUser: (user) => set({ user, loaded: true }),
  logout: async () => {
    await api("POST", "/api/auth/logout").catch(() => undefined);
    set({ user: null });
  },
}));

// ---------- Toasts ----------
export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  text: string;
}
interface ToastState {
  toasts: Toast[];
  push: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
}
let tid = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const id = ++tid;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 6000 : 3500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function toastError(err: unknown): void {
  useToasts.getState().push("error", err instanceof ApiError || err instanceof Error ? err.message : "Algo deu errado.");
}
