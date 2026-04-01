import { clientEnv } from "@abadge/env/client";

const API_URL = clientEnv.NEXT_PUBLIC_API_URL;
type SocialProvider = "github" | "google";

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

  async signInWithSocial(provider: SocialProvider, callbackURL: string) {
    const res = await fetch(`${API_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        provider,
        callbackURL,
        errorCallbackURL: callbackURL,
        disableRedirect: true,
      }),
    });

    const data = await res
      .json()
      .catch(() => ({}) as { url?: string; message?: string; error?: { message?: string } });

    if (!res.ok || typeof data.url !== "string") {
      return {
        error: {
          message:
            data.error?.message ??
            data.message ??
            `Could not start ${provider === "google" ? "Google" : "GitHub"} sign-in`,
        },
      };
    }

    return { error: null, url: data.url };
  },

  async signOut() {
    await fetch(`${API_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
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
