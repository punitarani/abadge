import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "abadge",
  description:
    "Credential control plane for AI agents. Store or connect credentials, grant least-privilege access, and audit every attempt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
