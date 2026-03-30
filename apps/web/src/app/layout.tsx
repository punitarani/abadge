import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "abadge",
  description: "One password for agents. Store secrets, grant access, audit everything.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
