"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SocialProvider } from "@/lib/auth-client";

interface SocialAuthButtonsProps {
  providers: SocialProvider[];
  loadingProvider: SocialProvider | null;
  onProviderClick: (provider: SocialProvider) => void;
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path
        d="M21.8 12.23c0-.74-.06-1.28-.2-1.84H12v3.48h5.65c-.11.86-.72 2.16-2.07 3.03l-.02.12 3 2.27.2.02c1.81-1.63 3.04-4.02 3.04-7.08Z"
        fill="currentColor"
      />
      <path
        d="M12 22c2.76 0 5.08-.89 6.77-2.43l-3.22-2.41c-.86.59-2.01 1-3.55 1-2.7 0-4.99-1.74-5.81-4.15l-.12.01-3.11 2.36-.04.11C4.6 19.74 8.02 22 12 22Z"
        fill="currentColor"
      />
      <path
        d="M6.19 14.01A6 6 0 0 1 5.85 12c0-.7.12-1.38.33-2.01l-.01-.14-3.15-2.4-.1.05A9.8 9.8 0 0 0 2 12c0 1.59.38 3.1 1.05 4.45l3.14-2.44Z"
        fill="currentColor"
      />
      <path
        d="M12 5.84c1.94 0 3.25.82 3.99 1.51l2.91-2.77C17.07 2.93 14.76 2 12 2 8.02 2 4.6 4.26 2.92 7.55l3.26 2.49C7.01 7.58 9.3 5.84 12 5.84Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.2c-3.33.72-4.03-1.4-4.03-1.4-.55-1.36-1.33-1.72-1.33-1.72-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.22 1.84 1.22 1.08 1.8 2.82 1.28 3.51.98.11-.76.42-1.28.76-1.58-2.66-.3-5.47-1.3-5.47-5.86 0-1.3.47-2.37 1.24-3.2-.12-.3-.54-1.53.12-3.19 0 0 1.02-.32 3.34 1.22a11.8 11.8 0 0 1 6.08 0c2.31-1.54 3.33-1.22 3.33-1.22.67 1.66.25 2.89.12 3.19.77.83 1.24 1.9 1.24 3.2 0 4.57-2.82 5.55-5.5 5.85.43.37.82 1.09.82 2.2v3.27c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

export function SocialAuthButtons({
  providers,
  loadingProvider,
  onProviderClick,
}: SocialAuthButtonsProps) {
  const buttons: Record<SocialProvider, { label: string; icon: ReactNode }> = {
    github: {
      label: "GitHub",
      icon: <GitHubIcon />,
    },
    google: {
      label: "Google",
      icon: <GoogleIcon />,
    },
  };

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>Or continue with</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="w-full justify-center gap-2"
            disabled={loadingProvider !== null}
            onClick={() => onProviderClick(provider)}
          >
            {buttons[provider].icon}
            {loadingProvider === provider
              ? `Connecting ${buttons[provider].label}...`
              : buttons[provider].label}
          </Button>
        ))}
      </div>
    </div>
  );
}
