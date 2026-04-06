import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { Space_Grotesk } from "next/font/google";
import { AppProviders } from "@/lib/trpc-provider";
import { cn } from "@/lib/utils";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "abadge",
  description:
    "Credential control plane for AI agents. Store or connect credentials, allow least-privilege access, and audit every attempt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", spaceGrotesk.variable)}>
      <body>
        <NuqsAdapter>
          <AppProviders>{children}</AppProviders>
        </NuqsAdapter>
      </body>
    </html>
  );
}
