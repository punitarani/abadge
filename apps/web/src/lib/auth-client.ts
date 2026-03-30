import { clientEnv } from "@abadge/env/client";

const API_URL = clientEnv.NEXT_PUBLIC_API_URL;

export const authClient = {
  async signIn(email: string, password: string) {
    const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        error: { message: (data as { message?: string }).message ?? "Sign in failed" },
      };
    }
    return { error: null };
  },

  async signUp(name: string, email: string, password: string) {
    const res = await fetch(`${API_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        error: { message: (data as { message?: string }).message ?? "Registration failed" },
      };
    }
    return { error: null };
  },

  async signOut() {
    await fetch(`${API_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
  },

  async getSession() {
    const res = await fetch(`${API_URL}/api/auth/get-session`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return res.json();
  },
};
