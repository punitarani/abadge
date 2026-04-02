import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { AppProviders } from "@/lib/trpc-provider";

export const metadata: Metadata = {
  title: "abadge",
  description:
    "Credential control plane for AI agents. Store or connect credentials, allow least-privilege access, and audit every attempt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NuqsAdapter>
          <AppProviders>{children}</AppProviders>
        </NuqsAdapter>
      </body>
    </html>
  );
}
