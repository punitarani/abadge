import {
  type SocialAuthProvidersResponse,
  type SocialProvider,
  socialProviders,
} from "@abadge/core";
import { clientEnv } from "@abadge/env/client";

const API_URL = clientEnv.NEXT_PUBLIC_API_URL;

interface SocialSignInOptions {
  callbackURL: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
  requestSignUp?: boolean;
}

function parseAvailableProviders(data: unknown): SocialProvider[] {
  const providers = (data as SocialAuthProvidersResponse | null)?.providers;

  if (!Array.isArray(providers)) {
    return [];
  }

  return providers.filter((provider): provider is SocialProvider =>
    socialProviders.includes(provider as SocialProvider),
  );
}

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

  async signInWithSocial(provider: SocialProvider, options: SocialSignInOptions) {
    const res = await fetch(`${API_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        provider,
        callbackURL: options.callbackURL,
        errorCallbackURL: options.errorCallbackURL,
        newUserCallbackURL: options.newUserCallbackURL,
        requestSignUp: options.requestSignUp,
        disableRedirect: true,
      }),
    });

    const data = await res
      .json()
      .catch(() => ({}) as { url?: string; message?: string; error?: { message?: string } });

    if (!res.ok || typeof data.url !== "string") {
      const rawMessage = data.error?.message ?? data.message;
      const fallbackMessage =
        rawMessage === "Provider not found"
          ? `${provider === "google" ? "Google" : "GitHub"} sign-in is not configured on this server`
          : `Could not start ${provider === "google" ? "Google" : "GitHub"} sign-in`;

      return {
        error: {
          message:
            rawMessage === "Provider not found" ? fallbackMessage : (rawMessage ?? fallbackMessage),
        },
      };
    }

    return { error: null, url: data.url };
  },

  async getAvailableSocialProviders(): Promise<SocialProvider[]> {
    const res = await fetch(`${API_URL}/v1/auth/providers`, {
      credentials: "include",
    });

    if (!res.ok) {
      return [...socialProviders];
    }

    const data = await res.json().catch(() => null);
    const providers = parseAvailableProviders(data);
    return providers.length > 0 ? providers : [];
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
