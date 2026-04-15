import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AppProviders } from "@/lib/trpc-provider";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: {
    template: "%s · abadge",
    default: "abadge — Credential control plane for AI agents",
  },
  description:
    "Credential control plane for AI agents. Store or connect credentials, allow least-privilege access, and audit every attempt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(inter.variable, ibmPlexMono.variable)}>
      <body>
        <NuqsAdapter>
          <AppProviders>
            {children}
            <Toaster />
          </AppProviders>
        </NuqsAdapter>
      </body>
    </html>
  );
}
